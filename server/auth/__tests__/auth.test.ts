import { describe, it, expect } from 'vitest';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/context.js';
import { Sha256Hasher } from '../domain/passwordHasher.js';
import { TokenService } from '../domain/tokenService.js';
import { AuthorizationService, type AuthPrincipal } from '../domain/authorizationService.js';
import { AuthService } from '../services/authService.js';
import { AuthError } from '../domain/errors.js';
import { loadAuthConfig } from '../config.js';

const SECRET = 'test-secret-not-real';
const TS = '2026-06-01T12:00:00.000Z';
const hasher = new Sha256Hasher();

// пароль для сид-пользователя
const PASSWORD = 'secret123';

function ctxWithUsers() {
  const gw = new InMemoryGateway({
    users: [
      { id: 'u-boss', username: 'boss', fullName: 'Владелец', role: 'admin', isActive: true, createdAt: TS },
      { id: 'u-admin', username: 'admin', fullName: 'Админ', role: 'admin', isActive: true, createdAt: TS },
      { id: 'u-blocked', username: 'blocked', fullName: 'Блок', role: 'viewer', isActive: false, createdAt: TS },
    ],
    passwords: [
      { id: 'u-boss', hash: hasher.hash(PASSWORD) },
      { id: 'u-admin', hash: hasher.hash(PASSWORD) },
      { id: 'u-blocked', hash: hasher.hash(PASSWORD) },
    ],
  });
  return createServiceContext(gw);
}

describe('Sha256Hasher', () => {
  it('hash детерминирован, verify корректен (sha256 hex, без соли)', () => {
    const h = hasher.hash('8888');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.verify('8888', h)).toBe(true);
    expect(hasher.verify('9999', h)).toBe(false);
    expect(hasher.algo).toBe('sha256');
  });
});

describe('TokenService (формат legacy 1:1)', () => {
  it('конструктор без секрета → CONFIG', () => {
    expect(() => new TokenService('')).toThrow(AuthError);
  });

  it('create → verify (валидный), payload содержит id/username/role/fullName/exp(ms)', () => {
    const now = 1_000_000;
    const svc = new TokenService(SECRET, { now: () => now });
    const token = svc.create({ id: 'u-boss', username: 'boss', role: 'admin', fullName: 'Владелец' });
    expect(token.split('.')).toHaveLength(3);
    const res = svc.verify(token);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.claims.username).toBe('boss');
      expect(res.claims.role).toBe('admin');
      expect(res.claims.exp).toBe(now + 24 * 60 * 60 * 1000); // exp в миллисекундах
    }
  });

  it('подделанная подпись → bad_signature', () => {
    const svc = new TokenService(SECRET, { now: () => 1000 });
    const token = svc.create({ id: 'u', username: 'boss', role: 'admin', fullName: 'X' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    const res = svc.verify(tampered);
    expect(res).toMatchObject({ valid: false, reason: 'bad_signature' });
  });

  it('истёкший токен → expired', () => {
    const signer = new TokenService(SECRET, { now: () => 1000 });
    const token = signer.create({ id: 'u', username: 'boss', role: 'admin', fullName: 'X' });
    const later = new TokenService(SECRET, { now: () => 1000 + 25 * 60 * 60 * 1000 });
    expect(later.verify(token)).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('кривой токен → malformed', () => {
    const svc = new TokenService(SECRET);
    expect(svc.verify('abc')).toMatchObject({ valid: false, reason: 'malformed' });
  });

  it('другой секрет не проходит проверку', () => {
    const a = new TokenService('secret-a', { now: () => 1000 });
    const b = new TokenService('secret-b', { now: () => 1000 });
    const token = a.create({ id: 'u', username: 'boss', role: 'admin', fullName: 'X' });
    expect(b.verify(token).valid).toBe(false);
  });
});

describe('AuthorizationService (предикаты legacy 1:1)', () => {
  const authz = new AuthorizationService();
  const boss: AuthPrincipal = { username: 'boss', role: 'admin' };
  const admin: AuthPrincipal = { username: 'admin', role: 'admin' };
  const viewer: AuthPrincipal = { username: 'manager', role: 'viewer' };

  it('hasRole / isAdmin', () => {
    expect(authz.hasRole(admin, ['admin'])).toBe(true);
    expect(authz.hasRole(viewer, ['admin'])).toBe(false);
    expect(authz.isAdmin(admin)).toBe(true);
    expect(authz.isAdmin(viewer)).toBe(false);
  });

  it('canApproveAnomaly: boss=true, admin=false, viewer=false', () => {
    expect(authz.canApproveAnomaly(boss)).toBe(true);
    expect(authz.canApproveAnomaly(admin)).toBe(false);
    expect(authz.canApproveAnomaly(viewer)).toBe(false);
  });

  it('canEditNormatives: только boss', () => {
    expect(authz.canEditNormatives(boss)).toBe(true);
    expect(authz.canEditNormatives(admin)).toBe(false);
  });

  it('requireRole/requireApproveAnomaly бросают FORBIDDEN', () => {
    expect(() => authz.requireRole(viewer, ['admin'])).toThrow(AuthError);
    expect(() => authz.requireApproveAnomaly(admin)).toThrow(AuthError);
  });
});

describe('AuthService.login', () => {
  const token = () => new TokenService(SECRET, { now: () => 1000 });

  it('успех → token + user', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    const res = await svc.login('boss', PASSWORD);
    expect(res.token.split('.')).toHaveLength(3);
    expect(res.user).toEqual({ id: 'u-boss', username: 'boss', fullName: 'Владелец', role: 'admin' });
  });

  it('логин без учёта регистра username', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    const res = await svc.login('BOSS', PASSWORD);
    expect(res.user.id).toBe('u-boss');
  });

  it('нет полей → MISSING_CREDENTIALS', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    await expect(svc.login('', '')).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
  });

  it('неизвестный пользователь → USER_NOT_FOUND', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    await expect(svc.login('ghost', PASSWORD)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('заблокированный пользователь → USER_NOT_FOUND', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    await expect(svc.login('blocked', PASSWORD)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('неверный пароль → INVALID_PASSWORD', async () => {
    const svc = new AuthService(ctxWithUsers(), token(), hasher);
    await expect(svc.login('boss', 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
  });
});

describe('AuthService.getCurrentUser', () => {
  it('валидный токен → user из payload', async () => {
    const ts = new TokenService(SECRET, { now: () => 1000 });
    const svc = new AuthService(ctxWithUsers(), ts, hasher);
    const { token } = await svc.login('admin', PASSWORD);
    expect(svc.getCurrentUser(token)).toEqual({ id: 'u-admin', username: 'admin', fullName: 'Админ', role: 'admin' });
  });

  it('истёкший → TOKEN_EXPIRED; кривой → TOKEN_INVALID', async () => {
    const signer = new TokenService(SECRET, { now: () => 1000 });
    const token = signer.create({ id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' });
    const laterSvc = new AuthService(ctxWithUsers(), new TokenService(SECRET, { now: () => 1000 + 25 * 3600 * 1000 }), hasher);
    expect(() => laterSvc.getCurrentUser(token)).toThrow(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));

    const svc = new AuthService(ctxWithUsers(), new TokenService(SECRET), hasher);
    expect(() => svc.getCurrentUser('garbage')).toThrow(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });
});

describe('loadAuthConfig', () => {
  it('нет JWT_SECRET → CONFIG', () => {
    expect(() => loadAuthConfig({} as NodeJS.ProcessEnv)).toThrow(AuthError);
  });
  it('есть JWT_SECRET → возвращает секрет', () => {
    expect(loadAuthConfig({ JWT_SECRET: 'x' } as NodeJS.ProcessEnv)).toEqual({ jwtSecret: 'x' });
  });
});
