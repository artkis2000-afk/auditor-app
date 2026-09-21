import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { JoseFirebaseTokenVerifier } from '../firebaseTokenVerifier.js';
import { AuthorizationService, type AuthPrincipal } from '../domain/authorizationService.js';
import { loadFirebaseAuthConfig } from '../config.js';
import { AuthError } from '../domain/errors.js';

const PROJECT = 'demo-project';
const ISS = `https://securetoken.google.com/${PROJECT}`;

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
type PrivKey = KeyPair['privateKey'];
let privateKey: PrivKey;
let publicKey: KeyPair['publicKey'];
let otherPrivateKey: PrivKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256'));
  ({ privateKey: otherPrivateKey } = await generateKeyPair('RS256'));
});

function verifier() {
  // Инъекция локального публичного ключа вместо remote JWKS — оффлайн-проверка подписи.
  return new JoseFirebaseTokenVerifier({ projectId: PROJECT, keySet: publicKey });
}

interface SignOpts {
  sub?: string | null;
  iss?: string;
  aud?: string;
  expSecondsFromNow?: number;
  key?: PrivKey;
  email?: string;
}

async function sign(opts: SignOpts = {}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ email: opts.email ?? 'u@example.com', email_verified: true, name: 'Пользователь' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? PROJECT)
    .setExpirationTime(nowSec + (opts.expSecondsFromNow ?? 3600));
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? 'uid-123');
  return jwt.sign(opts.key ?? privateKey);
}

describe('JoseFirebaseTokenVerifier', () => {
  it('валидный токен → identity (uid/email/emailVerified/name)', async () => {
    const token = await sign({ sub: 'uid-abc', email: 'owner@example.com' });
    const id = await verifier().verify(token);
    expect(id).toMatchObject({ uid: 'uid-abc', email: 'owner@example.com', emailVerified: true, name: 'Пользователь' });
  });

  it('истёкший токен → TOKEN_EXPIRED', async () => {
    const token = await sign({ expSecondsFromNow: -3600 });
    await expect(verifier().verify(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('неверный audience → TOKEN_INVALID', async () => {
    const token = await sign({ aud: 'other-project' });
    await expect(verifier().verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('неверный issuer → TOKEN_INVALID', async () => {
    const token = await sign({ iss: 'https://securetoken.google.com/evil' });
    await expect(verifier().verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('подпись чужим ключом → TOKEN_INVALID', async () => {
    const token = await sign({ key: otherPrivateKey });
    await expect(verifier().verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('нет subject (uid) → TOKEN_INVALID', async () => {
    const token = await sign({ sub: null });
    await expect(verifier().verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('кривая строка → TOKEN_INVALID', async () => {
    await expect(verifier().verify('not-a-jwt')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('пустой projectId → CONFIG', () => {
    expect(() => new JoseFirebaseTokenVerifier({ projectId: '' })).toThrow(AuthError);
  });
});

describe('AuthorizationService (предикаты, переходно до 5.2)', () => {
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

describe('loadFirebaseAuthConfig', () => {
  it('нет FIREBASE_PROJECT_ID/GCP_PROJECT_ID → CONFIG', () => {
    expect(() => loadFirebaseAuthConfig({} as NodeJS.ProcessEnv)).toThrow(AuthError);
  });

  it('projectId + парсинг AUTH_ADMIN_EMAILS (нижний регистр, trim)', () => {
    const cfg = loadFirebaseAuthConfig({
      FIREBASE_PROJECT_ID: 'proj',
      AUTH_ADMIN_EMAILS: ' Owner@Example.com , boss@x.ru ',
    } as NodeJS.ProcessEnv);
    expect(cfg.projectId).toBe('proj');
    expect(cfg.adminEmails).toEqual(['owner@example.com', 'boss@x.ru']);
  });

  it('GCP_PROJECT_ID как fallback; пустой AUTH_ADMIN_EMAILS → []', () => {
    const cfg = loadFirebaseAuthConfig({ GCP_PROJECT_ID: 'proj2' } as NodeJS.ProcessEnv);
    expect(cfg.projectId).toBe('proj2');
    expect(cfg.adminEmails).toEqual([]);
  });
});
