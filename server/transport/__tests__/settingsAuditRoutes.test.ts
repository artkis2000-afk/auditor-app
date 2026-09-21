import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import {
  createServiceContext,
  SupplierService,
  AuditService,
  type ServiceContext,
  type Actor,
} from '../../services/index.js';
import type { FirestoreGateway } from '../../db/index.js';
import { seedPrincipals, makeAuthDeps } from './_testAuth.js';

const adminActor: Actor = { id: 'u-admin', username: 'admin', role: 'admin' };

async function buildWith(gateway: FirestoreGateway) {
  const ctx: ServiceContext = createServiceContext(gateway);
  const app = createApp({ ctx, ...makeAuthDeps(ctx) });
  const tokens = await seedPrincipals(ctx, {
    admin: { id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' },
    viewer: { id: 'u-viewer', username: 'viewer', role: 'viewer', fullName: 'Аудитор' },
  });
  return { app, ctx, tokens };
}
async function build() {
  return buildWith(new InMemoryGateway());
}
const B = (t: string) => `Bearer ${t}`;

describe('Settings routes', () => {
  it('GET: no auth → 401; authenticated → 200 (дефолты)', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/settings')).status).toBe(401);
    const res = await request(app).get('/api/settings').set('Authorization', B(tokens.viewer));
    expect(res.status).toBe(200);
    expect(res.body.anomalyThreshold).toBe(10);
  });

  it('POST: no auth → 401; viewer → 403; admin → 200 {success,settings}; invalid body → 400', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/settings').send({ anomalyThreshold: 20 })).status).toBe(401);
    expect((await request(app).post('/api/settings').set('Authorization', B(tokens.viewer)).send({ anomalyThreshold: 20 })).status).toBe(403);
    const ok = await request(app).post('/api/settings').set('Authorization', B(tokens.admin)).send({ anomalyThreshold: 25 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.anomalyThreshold).toBe(25);
    // невалидное тело (не объект) → 400
    expect((await request(app).post('/api/settings').set('Authorization', B(tokens.admin)).send([1, 2, 3])).status).toBe(400);
  });

  it('KI-12 сохранён: settings_update пишет oldValues=null (транспорт со snapshot не работает)', async () => {
    const { app, ctx, tokens } = await build();
    await request(app).post('/api/settings').set('Authorization', B(tokens.admin)).send({ anomalyThreshold: 30 });
    const log = (await new AuditService(ctx).list()).find((l) => l.action === 'settings_update')!;
    expect(log.oldValues).toBeNull();
  });

  it('ошибка сервиса → 500 без стека', async () => {
    const throwing: FirestoreGateway = {
      getAll: async () => [],
      getById: async () => {
        throw new Error('db down');
      },
      set: async () => {},
      delete: async () => {},
      commitBatch: async () => {},
    };
    const { app, tokens } = await buildWith(throwing);
    const res = await request(app).get('/api/settings').set('Authorization', B(tokens.admin));
    expect(res.status).toBe(500);
    expect(res.body.stack).toBeUndefined();
    expect(res.body.error).not.toContain('db down');
  });
});

describe('Audit routes', () => {
  it('GET: no auth → 401; viewer → 403; admin → 200 массив', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/audit-logs')).status).toBe(401);
    expect((await request(app).get('/api/audit-logs').set('Authorization', B(tokens.viewer))).status).toBe(403);
    const res = await request(app).get('/api/audit-logs').set('Authorization', B(tokens.admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('rollback: no auth → 401; viewer → 403; admin (поддерживаемое действие) → 200', async () => {
    const { app, ctx, tokens } = await build();
    const sup = new SupplierService(ctx);
    const s = await sup.create({ name: 'Старое', inn: '111' }, adminActor);
    await sup.update(s.id, { name: 'Новое', inn: '111', isApproved: true }, adminActor);
    const editLogId = (await new AuditService(ctx).list()).find((l) => l.action === 'supplier_edit')!.id;

    expect((await request(app).post(`/api/audit-logs/${editLogId}/rollback`)).status).toBe(401);
    expect((await request(app).post(`/api/audit-logs/${editLogId}/rollback`).set('Authorization', B(tokens.viewer))).status).toBe(403);
    const ok = await request(app).post(`/api/audit-logs/${editLogId}/rollback`).set('Authorization', B(tokens.admin));
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });

  it('rollback: отсутствующий лог → 404', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/audit-logs/nope/rollback').set('Authorization', B(tokens.admin))).status).toBe(404);
  });

  it('rollback: неподдерживаемое действие → 400 (UNSUPPORTED)', async () => {
    const { app, ctx, tokens } = await build();
    const log = await new AuditService(ctx).log({
      userId: 'u-admin',
      username: 'admin',
      action: 'invoice_reconcile',
      entityType: 'invoice',
      entityId: 'inv-x',
    });
    const res = await request(app).post(`/api/audit-logs/${log.id}/rollback`).set('Authorization', B(tokens.admin));
    expect(res.status).toBe(400);
  });
});
