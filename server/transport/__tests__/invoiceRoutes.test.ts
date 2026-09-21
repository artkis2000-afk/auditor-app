import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Nomenclature, Vehicle } from '../../../shared/index.js';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext, InvoiceService, type ServiceContext, type Actor } from '../../services/index.js';
import { seedPrincipals, makeAuthDeps } from './_testAuth.js';

const TS = '2026-06-01T12:00:00.000Z';
const nomN1: Nomenclature = {
  id: 'N1', normalizedName: 'Фильтр', category: '', normativeServiceDays: 180, notes: '', createdAt: TS, updatedAt: TS, deletedAt: null,
};
const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };
const adminActor: Actor = { id: 'u-admin', username: 'admin', role: 'admin' };

async function build() {
  const gw = new InMemoryGateway({
    nomenclature: [nomN1],
    vehicles: [vehVolvo],
  });
  const ctx: ServiceContext = createServiceContext(gw);
  const app = createApp({ ctx, ...makeAuthDeps(ctx) });
  const tokens = await seedPrincipals(ctx, {
    boss: { id: 'u-boss', username: 'boss', role: 'admin', fullName: 'Владелец' },
    admin: { id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' },
    viewer: { id: 'u-viewer', username: 'viewer', role: 'viewer', fullName: 'Аудитор' },
    manager: { id: 'u-mgr', username: 'mgr', role: 'manager', fullName: 'Менеджер' },
  });
  return { app, ctx, tokens };
}

const bearer = (app: Express, method: 'get' | 'post' | 'put' | 'delete', path: string, token?: string) => {
  const r = request(app)[method](path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

async function seedInvoice(ctx: ServiceContext, date = '2026-02-01'): Promise<string> {
  const svc = new InvoiceService(ctx);
  const { invoiceId } = await svc.createManual(
    { recognizedDate: date, items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
    adminActor,
  );
  return invoiceId;
}

async function seedFlagged(ctx: ServiceContext): Promise<string> {
  await seedInvoice(ctx, '2026-01-01');
  return seedInvoice(ctx, '2026-02-01'); // дубликат → flagged
}

describe('GET /api/invoices', () => {
  it('no auth → 401', async () => {
    const { app } = await build();
    expect((await request(app).get('/api/invoices')).status).toBe(401);
  });
  it('valid auth → 200 массив (+imagePath placeholder)', async () => {
    const { app, ctx, tokens } = await build();
    await seedInvoice(ctx);
    const res = await bearer(app, 'get', '/api/invoices', tokens.viewer);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].imagePath).toBe('/assets/invoice_placeholder.png');
  });
  it('невалидный query status → 400', async () => {
    const { app, tokens } = await build();
    const res = await bearer(app, 'get', '/api/invoices?status=bogus', tokens.viewer);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/invoices/:id', () => {
  it('missing → 404', async () => {
    const { app, tokens } = await build();
    expect((await bearer(app, 'get', '/api/invoices/nope', tokens.viewer)).status).toBe(404);
  });
  it('valid → 200 (invoice/items/suggestions)', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    const res = await bearer(app, 'get', `/api/invoices/${id}`, tokens.viewer);
    expect(res.status).toBe(200);
    expect(res.body.invoice.id).toBe(id);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('POST /api/invoices/manual', () => {
  const body = { recognizedDate: '2026-02-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000 }] };
  it('no auth → 401', async () => {
    const { app } = await build();
    expect((await request(app).post('/api/invoices/manual').send(body)).status).toBe(401);
  });
  it('viewer → 403', async () => {
    const { app, tokens } = await build();
    expect((await bearer(app, 'post', '/api/invoices/manual', tokens.viewer).send(body)).status).toBe(403);
  });
  it('admin → 200', async () => {
    const { app, tokens } = await build();
    const res = await bearer(app, 'post', '/api/invoices/manual', tokens.admin).send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.invoiceId).toBeTruthy();
  });
  it('manager → 200 (legacy permission сохранена)', async () => {
    const { app, tokens } = await build();
    expect((await bearer(app, 'post', '/api/invoices/manual', tokens.manager).send(body)).status).toBe(200);
  });
  it('невалидное тело (позиция без rawName) → 400', async () => {
    const { app, tokens } = await build();
    const res = await bearer(app, 'post', '/api/invoices/manual', tokens.admin).send({ items: [{ unitPrice: 100 }] });
    expect(res.status).toBe(400);
  });
});

describe('Invoice mutations (admin-only)', () => {
  const editBody = { recognizedDate: '2026-02-02', supplierName: 'ООО X', items: [{ rawName: 'Новое', quantity: 1, unitPrice: 500 }] };

  it('PUT: no auth 401 / viewer 403 / admin 200 / invalid 400', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    expect((await request(app).put(`/api/invoices/${id}`).send(editBody)).status).toBe(401);
    expect((await bearer(app, 'put', `/api/invoices/${id}`, tokens.viewer).send(editBody)).status).toBe(403);
    expect((await bearer(app, 'put', `/api/invoices/${id}`, tokens.admin).send(editBody)).status).toBe(200);
    expect((await bearer(app, 'put', `/api/invoices/${id}`, tokens.admin).send({})).status).toBe(400);
  });

  it('confirm: viewer 403 / admin 200', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    expect((await bearer(app, 'post', `/api/invoices/${id}/confirm`, tokens.viewer)).status).toBe(403);
    expect((await bearer(app, 'post', `/api/invoices/${id}/confirm`, tokens.admin)).status).toBe(200);
  });

  it('delete: viewer 403 / admin 200', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    expect((await bearer(app, 'delete', `/api/invoices/${id}`, tokens.viewer)).status).toBe(403);
    expect((await bearer(app, 'delete', `/api/invoices/${id}`, tokens.admin)).status).toBe(200);
  });

  it('bulk-delete: invalid body 400 / admin 200', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    expect((await bearer(app, 'post', '/api/invoices/bulk-delete', tokens.admin).send({})).status).toBe(400);
    const res = await bearer(app, 'post', '/api/invoices/bulk-delete', tokens.admin).send({ ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
  });

  it('batch-reconcile: viewer 403 / admin 200', async () => {
    const { app, ctx, tokens } = await build();
    const id = await seedInvoice(ctx);
    expect((await bearer(app, 'post', '/api/invoices/batch-reconcile', tokens.viewer).send({ ids: [id] })).status).toBe(403);
    const res = await bearer(app, 'post', '/api/invoices/batch-reconcile', tokens.admin).send({ ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(1);
  });
});

describe('Approve (boss-only через requireApproveAnomaly)', () => {
  it('approve-flag: no auth 401 / viewer 403 / обычный admin 403 / boss 200', async () => {
    const { app, ctx, tokens } = await build();
    const cId = await seedFlagged(ctx);
    const flag = (await ctx.repositories.anomalyFlags.getAll()).find((f) => f.invoiceId === cId)!;
    const bodyF = { flagId: flag.id };
    expect((await request(app).post(`/api/invoices/${cId}/approve-flag`).send(bodyF)).status).toBe(401);
    expect((await bearer(app, 'post', `/api/invoices/${cId}/approve-flag`, tokens.viewer).send(bodyF)).status).toBe(403);
    expect((await bearer(app, 'post', `/api/invoices/${cId}/approve-flag`, tokens.admin).send(bodyF)).status).toBe(403);
    const res = await bearer(app, 'post', `/api/invoices/${cId}/approve-flag`, tokens.boss).send(bodyF);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('approve-all-flags: обычный admin 403 / boss 200', async () => {
    const { app, ctx, tokens } = await build();
    const cId = await seedFlagged(ctx);
    expect((await bearer(app, 'post', `/api/invoices/${cId}/approve-all-flags`, tokens.admin)).status).toBe(403);
    expect((await bearer(app, 'post', `/api/invoices/${cId}/approve-all-flags`, tokens.boss)).status).toBe(200);
  });
});
