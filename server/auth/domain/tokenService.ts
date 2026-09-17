import crypto from 'node:crypto';
import type { UserRole } from '../../../shared/index.js';
import { AuthError } from './errors.js';

/**
 * Сессионный токен — перенос legacy generateToken/verifyTokenAndGetUser 1:1:
 * base64url(header).base64url(payload).HMAC-SHA256(header.payload, secret),
 * header={alg:HS256,typ:JWT}, payload={id,username,role,fullName,exp}, exp в МИЛЛИСЕКУНДАХ.
 * Без JWT-библиотеки. Секрет — только через DI (из env), без захардкоженного дефолта (KI-13).
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа, как в legacy

export interface TokenSubject {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
}

export interface TokenClaims extends TokenSubject {
  exp: number; // миллисекунды (Date.now()-based)
}

export type VerifyResult =
  | { valid: true; claims: TokenClaims }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly opts: { now?: () => number } = {},
  ) {
    if (!secret) {
      throw new AuthError('CONFIG', 'JWT secret не сконфигурирован (env JWT_SECRET).');
    }
  }

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private encode(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  }

  private sign(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  create(subject: TokenSubject): string {
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode({
      id: subject.id,
      username: subject.username,
      role: subject.role,
      fullName: subject.fullName,
      exp: this.nowMs() + TOKEN_TTL_MS,
    });
    const signature = this.sign(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  verify(token: string): VerifyResult {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return { valid: false, reason: 'malformed' };
      const [header, payloadStr, signature] = parts;
      const expected = this.sign(`${header}.${payloadStr}`);
      if (signature !== expected) return { valid: false, reason: 'bad_signature' };
      const payload = JSON.parse(Buffer.from(payloadStr!, 'base64url').toString('utf-8')) as TokenClaims;
      if (payload.exp < this.nowMs()) return { valid: false, reason: 'expired' };
      return { valid: true, claims: payload };
    } catch {
      return { valid: false, reason: 'malformed' };
    }
  }
}
