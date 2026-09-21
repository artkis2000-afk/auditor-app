import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext, type ServiceContext } from '../../services/index.js';
import { makeAuthDeps, encodeStubToken } from './_testAuth.js';

function build(opts: { adminEmails?: string[] } = {}) {
  const gw = new InMemoryGateway({});
  const ctx: ServiceContext = createServiceContext(gw);
  const app = createApp({ ctx, ...makeAuthDeps(ctx, opts) });
  return { app, ctx };
}

const ownerToken = encodeStubToken({ uid: 'uid-owner', email: 'owner@example.com', emailVerified: true, name: 'Владелец' });

describe('GET /api/health', () => {
  it('без auth → 200 {status:"ok"} и ничего лишнего', async () => {
    const { app } = build();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/secret|projectId|databaseId|firebase|jwt|stack/i);
  });
});

describe('GET /api/auth/me (Firebase identity)', () => {
  it('нет Authorization → 401', async () => {
    const { app } = build();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('без схемы Bearer → 401', async () => {
    const { app } = build();
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Token abc')).status).toBe(401);
  });

  it('кривой токен → 401', async () => {
    const { app } = build();
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('валидный токен → 200 {user}; создаётся users/{uid} (default-deny: viewer)', async () => {
    const { app, ctx } = build();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('uid-owner');
    expect(res.body.user.email).toBe('owner@example.com');
    expect(res.body.user.role).toBe('viewer'); // не в allowlist → default-deny
    const profile = await ctx.repositories.users.getById('uid-owner');
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Владелец');
  });

  it('email в AUTH_ADMIN_EMAILS → role admin (переходный bootstrap)', async () => {
    const { app } = build({ adminEmails: ['owner@example.com'] });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it('повторный /me → профиль не пересоздаётся (createdAt стабилен)', async () => {
    const { app, ctx } = build();
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    const first = await ctx.repositories.users.getById('uid-owner');
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    const second = await ctx.repositories.users.getById('uid-owner');
    expect(second!.createdAt).toBe(first!.createdAt);
  });
});

describe('error boundary', () => {
  it('контролируемая ошибка (кривой токен) → JSON {error}, а не stack trace', async () => {
    const { app } = build();
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });
});
