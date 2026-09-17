import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from '../../auth/index.js';

const SECRET = 'test-secret-not-real';
const TS = '2026-06-01T12:00:00.000Z';
const PASSWORD = 'secret123';
const hasher = new Sha256Hasher();

function buildApp() {
  const gw = new InMemoryGateway({
    users: [{ id: 'u-boss', username: 'boss', fullName: 'Владелец', role: 'admin', isActive: true, createdAt: TS }],
    passwords: [{ id: 'u-boss', hash: hasher.hash(PASSWORD) }],
  });
  const ctx = createServiceContext(gw);
  const tokenService = new TokenService(SECRET);
  const authService = new AuthService(ctx, tokenService, hasher);
  const app = createApp({ ctx, authService, authorizationService: new AuthorizationService(), tokenService });
  return { app, tokenService };
}

describe('GET /api/health', () => {
  it('без auth → 200 {status:"ok"} и ничего лишнего', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    // не раскрывает секреты/инфраструктуру
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/secret|projectId|databaseId|firebase|jwt|stack/i);
  });
});

describe('POST /api/auth/login', () => {
  it('success → 200 {token, user}', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'boss', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user).toEqual({ id: 'u-boss', username: 'boss', fullName: 'Владелец', role: 'admin' });
  });

  it('missing credentials → 400', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('unknown user → 401', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'ghost', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('wrong password → 401', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'boss', password: 'nope' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  async function loginToken(app: ReturnType<typeof buildApp>['app']): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ username: 'boss', password: PASSWORD });
    return res.body.token as string;
  }

  it('нет Authorization → 401', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('malformed Bearer → 401', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('invalid token → 401', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer a.b.c')).status).toBe(401);
  });

  it('expired token → 401', async () => {
    const { app } = buildApp();
    const expiredSigner = new TokenService(SECRET, { now: () => Date.now() - 25 * 60 * 60 * 1000 });
    const expired = expiredSigner.create({ id: 'u-boss', username: 'boss', role: 'admin', fullName: 'Владелец' });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  it('valid token → 200 {user}', async () => {
    const { app } = buildApp();
    const token = await loginToken(app);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('boss');
  });
});

describe('error boundary', () => {
  it('контролируемая ошибка (unknown user) → JSON {error}, а не stack trace', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'ghost', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/); // нет стека
  });
});
