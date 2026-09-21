import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { AuthError } from './domain/errors.js';

/**
 * Проверка Firebase ID-токена БЕЗ firebase-admin (см. PHASE 5.1 audit).
 *
 * Бэкенд остаётся keyless и без credential-пути Firebase Admin (который ранее ломался под WIF):
 * ID-токен — это обычный подписанный Google JWT (RS256), проверяемый публичными ключами.
 * `jose.createRemoteJWKSet` сам кэширует JWKS и обновляет его при промахе kid — serverless-friendly.
 *
 * Официальные требования к клеймам (https://firebase.google.com/docs/auth/admin/verify-id-tokens):
 *   alg = RS256; aud = <projectId>; iss = https://securetoken.google.com/<projectId>;
 *   exp в будущем; iat/auth_time в прошлом; sub — непустой uid.
 *
 * ОГРАНИЧЕНИЕ: независимая проверка НЕ детектирует ревокацию/дизейбл на стороне Firebase
 * (это требует credential-пути Admin SDK). Блокировка пользователя выполняется доменно
 * (users/{uid}.isActive, а в 5.2 — membership.status), проверяемо на каждом запросе.
 */

/** Проверенная Firebase-личность (результат верификации токена). */
export interface FirebaseIdentity {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

/** Абстракция проверки токена (реальная — jose; стаб — в тестах). */
export interface FirebaseTokenVerifier {
  verify(token: string): Promise<FirebaseIdentity>;
}

/** JWKS Firebase Secure Token Service (формат JWKS, совместимый с createRemoteJWKSet). */
export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Резолвер ключа для jwtVerify (реальный remote JWKS либо инъекция локального набора в тестах). */
type KeyResolver = Parameters<typeof jwtVerify>[1];

export interface JoseFirebaseVerifierOptions {
  projectId: string;
  /** Инъекция набора ключей (для оффлайн-тестов). По умолчанию — remote JWKS Google. */
  keySet?: KeyResolver;
  /** Допуск на рассинхрон часов (сек). По умолчанию 5. */
  clockToleranceSec?: number;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export class JoseFirebaseTokenVerifier implements FirebaseTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keySet: KeyResolver;
  private readonly clockToleranceSec: number;

  constructor(opts: JoseFirebaseVerifierOptions) {
    const projectId = opts.projectId?.trim();
    if (!projectId) {
      throw new AuthError('CONFIG', 'FIREBASE_PROJECT_ID не сконфигурирован для проверки ID-токена.');
    }
    this.issuer = `https://securetoken.google.com/${projectId}`;
    this.audience = projectId;
    this.clockToleranceSec = opts.clockToleranceSec ?? 5;
    this.keySet = opts.keySet ?? createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  }

  async verify(token: string): Promise<FirebaseIdentity> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keySet, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: this.clockToleranceSec,
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw new AuthError('TOKEN_EXPIRED', 'Токен аутентификации истёк. Войдите снова.');
      }
      // bad signature / wrong aud|iss / malformed / no matching key / etc.
      throw new AuthError('TOKEN_INVALID', 'Неверный токен аутентификации.');
    }

    const uid = asString(payload.sub);
    if (!uid) {
      throw new AuthError('TOKEN_INVALID', 'Неверный токен аутентификации (нет subject).');
    }
    // Firebase-специфично: auth_time (если присутствует) не должен быть в будущем.
    const authTime = payload.auth_time;
    if (typeof authTime === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (authTime > nowSec + this.clockToleranceSec) {
        throw new AuthError('TOKEN_INVALID', 'Неверный токен аутентификации (auth_time).');
      }
    }

    return {
      uid,
      email: asString(payload.email),
      emailVerified: typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
      name: asString(payload.name),
      picture: asString(payload.picture),
    };
  }
}

/** Фабрика верификатора для composition root. */
export function createFirebaseTokenVerifier(opts: JoseFirebaseVerifierOptions): FirebaseTokenVerifier {
  return new JoseFirebaseTokenVerifier(opts);
}
