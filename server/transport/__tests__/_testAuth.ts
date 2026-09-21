import {
  AuthError,
  AuthorizationService,
  type FirebaseIdentity,
  type FirebaseTokenVerifier,
} from '../../auth/index.js';
import { UserService, type ServiceContext } from '../../services/index.js';
import type { User, UserRole } from '../../../shared/index.js';

/**
 * Тестовые помощники для Firebase-аутентификации (оффлайн, без реального Firebase).
 * Стаб-токен = base64url(JSON(identity)); стаб-верификатор его декодирует.
 * Роль/username управляются через предварительно засеянный профиль users/{uid}.
 */

const TS = '2026-01-01T00:00:00.000Z';

export function encodeStubToken(identity: FirebaseIdentity): string {
  return Buffer.from(JSON.stringify(identity)).toString('base64url');
}

/** Стаб-верификатор: декодирует стаб-токен либо бросает TOKEN_INVALID (кривой/пустой uid). */
export class StubFirebaseTokenVerifier implements FirebaseTokenVerifier {
  async verify(token: string): Promise<FirebaseIdentity> {
    let parsed: FirebaseIdentity;
    try {
      parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')) as FirebaseIdentity;
    } catch {
      throw new AuthError('TOKEN_INVALID', 'Неверный токен аутентификации.');
    }
    if (!parsed || typeof parsed.uid !== 'string' || parsed.uid.length === 0) {
      throw new AuthError('TOKEN_INVALID', 'Неверный токен аутентификации.');
    }
    return parsed;
  }
}

export interface TestSubject {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
  email?: string;
}

/** Собирает Firebase-совместимые auth-зависимости для createApp. */
export function makeAuthDeps(ctx: ServiceContext, opts: { adminEmails?: string[] } = {}) {
  return {
    firebaseVerifier: new StubFirebaseTokenVerifier(),
    userService: new UserService(ctx, { adminEmails: opts.adminEmails }),
    authorizationService: new AuthorizationService(),
  };
}

/** Засевает профили users/{uid} и возвращает стаб-токены по ключам (типизировано по ключам). */
export async function seedPrincipals<K extends string>(
  ctx: ServiceContext,
  subjects: Record<K, TestSubject>,
): Promise<Record<K, string>> {
  const tokens = {} as Record<K, string>;
  for (const [key, subject] of Object.entries(subjects) as [K, TestSubject][]) {
    const email = subject.email ?? subject.username;
    const profile: User = {
      id: subject.id,
      username: subject.username,
      fullName: subject.fullName,
      role: subject.role,
      isActive: true,
      createdAt: TS,
      email,
      displayName: subject.fullName,
      photoURL: null,
      updatedAt: TS,
    };
    await ctx.repositories.users.upsert(profile);
    tokens[key] = encodeStubToken({ uid: subject.id, email, emailVerified: true, name: subject.fullName });
  }
  return tokens;
}
