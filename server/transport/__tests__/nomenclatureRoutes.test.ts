import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext, NomenclatureService, type ServiceContext, type Actor } from '../../services/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from '../../auth/index.js';

const SECRET = 'test-secret-not-real';
const TS = '2026-06-01T12:00:00.000Z';
const bossActor: Actor = { id: 'u-boss', username: 'boss', role: 'admin' };

function build() {
  const gw = new InMemoryGateway({
    users: [
      { id: 'u-boss', username: 'boss', fullName: 'Владелец', role: 'admin', isActive: true, createdAt: TS },
      { id: 'u-admin', username: 'admin', fullName: 'Админ', role: 'admin', isActive: true, createdAt: TS },
      { id: 'u-viewer', username: 'viewer', fullName: 'Аудитор', role: 'viewer', isActive: true, createdAt: TS },
    ],
  });
  const ctx = createServiceContext(gw);
  const tokenService = new TokenService(SECRET);
  const authService = new AuthService(ctx, tokenService, new Sha256Hasher());
  const app = createApp({ ctx, authService, authorizationService: new AuthorizationService(), tokenService });
  const tokens = {
    boss: tokenService.create({ id: 'u-boss', username: 'boss', role: 'admin', fullName: 'Владелец' }),
    admin: tokenService.create({ id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' }),
    viewer: tokenService.create({ id: 'u-viewer', username: 'viewer', role: 'viewer', fullName: 'Аудитор' }),
  };
  return { app, ctx, tokens };
}
const B = (t: string) => `Bearer ${t}`;

async function seedNomenclature(ctx: ServiceContext): Promise<string> {
  const svc = new NomenclatureService(ctx);
  const n = await svc.create({ normalizedName: 'Фильтр', normativeServiceDays: 0 }, bossActor);
  return n.id;
}

describe('Nomenclature routes — чтение', () => {
  it('GET/history/match без auth → 401; с auth → 200', async () => {
    const { app, ctx, tokens } = build();
    const id = await seedNomenclature(ctx);
    expect((await request(app).get('/api/nomenclature')).status).toBe(401);
    expect((await request(app).get('/api/nomenclature').set('Authorization', B(tokens.viewer))).status).toBe(200);
    expect((await request(app).get(`/api/nomenclature/${id}/history`).set('Authorization', B(tokens.viewer))).status).toBe(200);
    expect((await request(app).get('/api/nomenclature/match?q=Фильтр').set('Authorization', B(tokens.viewer))).status).toBe(200);
  });

  it('match массивный ?q → 400', async () => {
    const { app, tokens } = build();
    expect((await request(app).get('/api/nomenclature/match?q=a&q=b').set('Authorization', B(tokens.viewer))).status).toBe(400);
  });
});

describe('Nomenclature routes — мутации и нормативы', () => {
  it('POST: viewer → 403; admin без норматива → 200; invalid body → 400', async () => {
    const { app, tokens } = build();
    expect((await request(app).post('/api/nomenclature').set('Authorization', B(tokens.viewer)).send({ normalizedName: 'X' })).status).toBe(403);
    const ok = await request(app).post('/api/nomenclature').set('Authorization', B(tokens.admin)).send({ normalizedName: 'Деталь' });
    expect(ok.status).toBe(200);
    expect(ok.body.nomenclature.normalizedName).toBe('Деталь');
    expect((await request(app).post('/api/nomenclature').set('Authorization', B(tokens.admin)).send({})).status).toBe(400);
  });

  it('нормативы: admin с normative → 403 (проверка в сервисе); boss → 200', async () => {
    const { app, tokens } = build();
    // admin (не boss) пытается задать норматив → сервис бросает FORBIDDEN → 403
    expect(
      (await request(app).post('/api/nomenclature').set('Authorization', B(tokens.admin)).send({ normalizedName: 'A', normativeServiceDays: 180 })).status,
    ).toBe(403);
    // boss может задать норматив → 200
    const ok = await request(app).post('/api/nomenclature').set('Authorization', B(tokens.boss)).send({ normalizedName: 'B', normativeServiceDays: 180 });
    expect(ok.status).toBe(200);
    expect(ok.body.nomenclature.normativeServiceDays).toBe(180);
  });

  it('PUT: admin → 200; отсутствующий → 404; смена норматива admin → 403, boss → 200', async () => {
    const { app, ctx, tokens } = build();
    const id = await seedNomenclature(ctx); // normativeServiceDays=0
    expect(
      (await request(app).put(`/api/nomenclature/${id}`).set('Authorization', B(tokens.admin)).send({ notes: 'обновлено' })).status,
    ).toBe(200);
    expect((await request(app).put('/api/nomenclature/nope').set('Authorization', B(tokens.admin)).send({ notes: 'x' })).status).toBe(404);
    expect(
      (await request(app).put(`/api/nomenclature/${id}`).set('Authorization', B(tokens.admin)).send({ normativeServiceDays: 365 })).status,
    ).toBe(403);
    expect(
      (await request(app).put(`/api/nomenclature/${id}`).set('Authorization', B(tokens.boss)).send({ normativeServiceDays: 365 })).status,
    ).toBe(200);
  });

  it('DELETE: viewer → 403; admin → 200; отсутствующий → 404', async () => {
    const { app, ctx, tokens } = build();
    const id = await seedNomenclature(ctx);
    expect((await request(app).delete(`/api/nomenclature/${id}`).set('Authorization', B(tokens.viewer))).status).toBe(403);
    expect((await request(app).delete(`/api/nomenclature/${id}`).set('Authorization', B(tokens.admin))).status).toBe(200);
    expect((await request(app).delete('/api/nomenclature/nope').set('Authorization', B(tokens.admin))).status).toBe(404);
  });
});
