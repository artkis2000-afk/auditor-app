import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { InMemoryImageStore } from '../../storage/__tests__/inMemoryImageStore.js';
import { createServiceContext } from '../../services/index.js';
import { StubOcrProvider, PassthroughImagePreprocessor, type ParsedInvoice } from '../../ai/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from '../../auth/index.js';

const SECRET = 'test-secret-not-real';
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

function build(seed: Record<string, Array<{ id: string } & Record<string, unknown>>> = {}) {
  const gw = new InMemoryGateway(seed);
  const ctx = createServiceContext(gw);
  const tokenService = new TokenService(SECRET);
  const authService = new AuthService(ctx, tokenService, new Sha256Hasher());
  const imageStore = new InMemoryImageStore();
  const ocr = { primary: new StubOcrProvider(PARSED), preprocessor: new PassthroughImagePreprocessor(), imageStore };
  const app = createApp({ ctx, authService, authorizationService: new AuthorizationService(), tokenService, ocr, imageStore });
  const tokens = {
    admin: tokenService.create({ id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' }),
    manager: tokenService.create({ id: 'u-mgr', username: 'mgr', role: 'manager', fullName: 'Менеджер' }),
    viewer: tokenService.create({ id: 'u-view', username: 'view', role: 'viewer', fullName: 'Аудитор' }),
  };
  return { app, ctx, imageStore, tokens };
}

describe('POST /api/invoices/upload', () => {
  it('без токена → 401', async () => {
    const { app } = build();
    expect((await request(app).post('/api/invoices/upload').send({ base64: SMALL_B64 })).status).toBe(401);
  });

  it('viewer → 403', async () => {
    const { app, tokens } = build();
    expect(
      (await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.viewer)).send({ base64: SMALL_B64 })).status,
    ).toBe(403);
  });

  it('manager → 200 {success, status: processing}; изображение попадает в ImageStore', async () => {
    const { app, imageStore, tokens } = build();
    const res = await request(app)
      .post('/api/invoices/upload')
      .set('Authorization', B(tokens.manager))
      .send({ name: 'н.jpg', type: 'image/jpeg', base64: SMALL_B64 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('processing');
    expect(imageStore.size()).toBe(1);
  });

  it('admin → 200', async () => {
    const { app, tokens } = build();
    const res = await request(app)
      .post('/api/invoices/upload')
      .set('Authorization', B(tokens.admin))
      .send({ type: 'image/jpeg', base64: SMALL_B64 });
    expect(res.status).toBe(200);
  });

  it('невалидное тело (нет base64) → 400', async () => {
    const { app, tokens } = build();
    expect((await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.admin)).send({ name: 'x' })).status).toBe(400);
  });

  it('слишком большое изображение → 413', async () => {
    const { app, tokens } = build();
    const big = 'A'.repeat(4_500_000);
    const res = await request(app).post('/api/invoices/upload').set('Authorization', B(tokens.admin)).send({ type: 'image/jpeg', base64: big });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/invoices/:id/ocr', () => {
  it('без токена → 401', async () => {
    const { app } = build();
    expect((await request(app).post('/api/invoices/inv-ok/ocr')).status).toBe(401);
  });

  it('viewer → 403', async () => {
    const { app, tokens } = build();
    expect((await request(app).post('/api/invoices/inv-ok/ocr').set('Authorization', B(tokens.viewer))).status).toBe(403);
  });

  it('admin, отсутствующая накладная → 404', async () => {
    const { app, tokens } = build();
    expect((await request(app).post('/api/invoices/nope/ocr').set('Authorization', B(tokens.admin))).status).toBe(404);
  });

  it('admin, накладная без изображения → 404 (контролируемая ошибка, не 500)', async () => {
    const { app, tokens } = build({ invoices: [invoiceSeed({ id: 'inv-noimg', imagePath: '' })] });
    const res = await request(app).post('/api/invoices/inv-noimg/ocr').set('Authorization', B(tokens.admin));
    expect(res.status).toBe(404);
  });

  it('admin, успешный OCR по storage key → 200; storage key сохранён', async () => {
    const { app, ctx, imageStore, tokens } = build({
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
