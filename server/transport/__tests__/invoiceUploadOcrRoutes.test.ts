import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { InMemoryImageStore } from '../../storage/__tests__/inMemoryImageStore.js';
import { createServiceContext } from '../../services/index.js';
import { StubOcrProvider, PassthroughImagePreprocessor, type ParsedInvoice } from '../../ai/index.js';
import { seedPrincipals, makeAuthDeps } from './_testAuth.js';

const B = (t: string) => `Bearer ${t}`;
const SMALL_B64 = Buffer.from('fake-jpeg-bytes').toString('base64');

const PARSED: ParsedInvoice = {
  recognizedDate: '2026-02-01',
  supplierName: 'ООО OCR',
  totalSum: 100,
  detectedVehicle: '',
  items: [{ rawName: 'Болт', quantity: 1, unitPrice: 100, lineSum: 100 }],
};

function invoiceSeed(p: { id: string; imagePath: string }) {
  return {
    imagePath: p.imagePath,
    recognizedDate: '2026-01-01',
    status: 'processing',
    uploadedBy: 'u',
    supplierId: null,
    supplierName: null,
    rawSupplierName: null,
    totalSum: 0,
    isReconciled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    id: p.id,
  };
}

async function build(seed: Record<string, Array<{ id: string } & Record<string, unknown>>> = {}) {
  const gw = new InMemoryGateway(seed);
  const ctx = createServiceContext(gw);
  const imageStore = new InMemoryImageStore();
  const ocr = { primary: new StubOcrProvider(PARSED), preprocessor: new PassthroughImagePreprocessor(), imageStore };
  const app = createApp({ ctx, ...makeAuthDeps(ctx), ocr, imageStore });
  const tokens = await seedPrincipals(ctx, {
    admin: { id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' },
    manager: { id: 'u-mgr', username: 'mgr', role: 'manager', fullName: 'Менеджер' },
    viewer: { id: 'u-view', username: 'view', role: 'viewer', fullName: 'Аудитор' },
  });
  return { app, ctx, imageStore, tokens };
}

describe('POST /api/invoices/upload', () => {
  it('без токена → 401', async () => {
    const { app } = await build();
    expect((await request(app).post('/api/invoices/upload').send({ base64: SMALL_B64 })).status).toBe(401);
  });

  it('viewer → 403', async () => {
    const { app, tokens } = await build();
    expect(
      (await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.viewer)).send({ base64: SMALL_B64 })).status,
    ).toBe(403);
  });

  it('manager → 200 + initial OCR выполнен server-side (позиции созданы, статус не processing)', async () => {
    const { app, ctx, imageStore, tokens } = await build();
    const res = await request(app)
      .post('/api/invoices/upload')
      .set('Authorization', B(tokens.manager))
      .send({ name: 'н.jpg', type: 'image/jpeg', base64: SMALL_B64 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).not.toBe('processing'); // initial OCR отработал по загрузке
    expect(imageStore.size()).toBe(1);
    const items = await ctx.repositories.invoiceItems.listByInvoice(res.body.invoiceId);
    expect(items.length).toBeGreaterThan(0);
  });

  it('admin → 200 + initial OCR выполнен', async () => {
    const { app, ctx, tokens } = await build();
    const res = await request(app)
      .post('/api/invoices/upload')
      .set('Authorization', B(tokens.admin))
      .send({ type: 'image/jpeg', base64: SMALL_B64 });
    expect(res.status).toBe(200);
    expect((await ctx.repositories.invoiceItems.listByInvoice(res.body.invoiceId)).length).toBeGreaterThan(0);
  });

  it('невалидное тело (нет base64) → 400', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.admin)).send({ name: 'x' })).status).toBe(400);
  });

  it('слишком большое изображение → 413', async () => {
    const { app, tokens } = await build();
    const big = 'A'.repeat(4_500_000);
    const res = await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.admin)).send({ type: 'image/jpeg', base64: big });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/invoices/:id/ocr', () => {
  it('без токена → 401', async () => {
    const { app } = await build();
    expect((await request(app).post('/api/invoices/inv-ok/ocr')).status).toBe(401);
  });

  it('viewer → 403', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/invoices/inv-ok/ocr').set('Authorization', B(tokens.viewer))).status).toBe(403);
  });

  it('admin, отсутствующая накладная → 404', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/invoices/nope/ocr').set('Authorization', B(tokens.admin))).status).toBe(404);
  });

  it('manager → 403 на ручной re-OCR (initial OCR идёт через upload, manual — admin-only)', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/invoices/inv-ok/ocr').set('Authorization', B(tokens.manager))).status).toBe(403);
  });

  it('admin, накладная без изображения → 404 (контролируемая ошибка, не 500)', async () => {
    const { app, tokens } = await build({ invoices: [invoiceSeed({ id: 'inv-noimg', imagePath: '' })] });
    const res = await request(app).post('/api/invoices/inv-noimg/ocr').set('Authorization', B(tokens.admin));
    expect(res.status).toBe(404);
  });

  it('admin, успешный OCR по storage key → 200; storage key сохранён', async () => {
    const { app, ctx, imageStore, tokens } = await build({
      invoices: [invoiceSeed({ id: 'inv-ok', imagePath: 'invoices/inv-ok/original.jpg' })],
    });
    await imageStore.put('invoices/inv-ok/original.jpg', Buffer.from('IMG'), 'image/jpeg');

    const res = await request(app).post('/api/invoices/inv-ok/ocr').set('Authorization', B(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.itemsCount).toBe(1);
    const inv = await ctx.repositories.invoices.getById('inv-ok');
    expect(inv!.imagePath).toBe('invoices/inv-ok/original.jpg'); // сохранён
  });
});

describe('GET /api/invoices/:id/image', () => {
  it('без токена → 401', async () => {
    const { app } = await build({ invoices: [invoiceSeed({ id: 'inv-img', imagePath: 'invoices/inv-img/original.jpg' })] });
    expect((await request(app).get('/api/invoices/inv-img/image')).status).toBe(401);
  });

  it('auth + storage key → 200 с байтами и content-type', async () => {
    const { app, imageStore, tokens } = await build({
      invoices: [invoiceSeed({ id: 'inv-img', imagePath: 'invoices/inv-img/original.jpg' })],
    });
    await imageStore.put('invoices/inv-img/original.jpg', Buffer.from('JPEGBYTES'), 'image/jpeg');
    const res = await request(app).get('/api/invoices/inv-img/image').set('Authorization', B(tokens.viewer));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body.toString()).toBe('JPEGBYTES');
  });

  it('нет изображения (imagePath пуст) → 404', async () => {
    const { app, tokens } = await build({ invoices: [invoiceSeed({ id: 'inv-noimg', imagePath: '' })] });
    expect((await request(app).get('/api/invoices/inv-noimg/image').set('Authorization', B(tokens.viewer))).status).toBe(404);
  });
});
