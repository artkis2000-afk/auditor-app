import crypto from 'node:crypto';

/**
 * Хеширование паролей. Шов для будущей смены алгоритма (argon2/bcrypt) без переписывания auth.
 * Sha256Hasher — перенос legacy hashPassword 1:1 (sha256 hex, БЕЗ соли — сохранено намеренно, KI-5-подобно).
 */
export interface PasswordHasher {
  readonly algo: string;
  hash(password: string): string;
  verify(password: string, storedHash: string): boolean;
}

export class Sha256Hasher implements PasswordHasher {
  readonly algo = 'sha256';

  hash(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  verify(password: string, storedHash: string): boolean {
    return this.hash(password) === storedHash;
  }
}
