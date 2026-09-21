import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { composeApp } from '../composeApp.js';
import { InMemoryGateway } from '../repositories/__tests__/inMemoryGateway.js';
import { InMemoryImageStore } from '../storage/__tests__/inMemoryImageStore.js';
import { DeterministicMockOcrProvider, PassthroughImagePreprocessor } from '../ai/index.js';

/**
 * Smoke composition root: собираем приложение той же функцией composeApp(), что и index.ts,
 * но с in-memory gateway/imageStore и стаб-OCR. Реального Firestore/Gemini нет —
 * проверяется только связность DI-графа (включая upload/OCR) и базовые контракты транспорта.
 */
function buildSmokeApp() {
  const imageStore = new InMemoryImageStore();
  return composeApp(new InMemoryGateway(), { projectId: 'demo-project', adminEmails: [] }, {
    imageStore,
    ocr: { fallback: new DeterministicMockOcrProvider(), preprocessor: new PassthroughImagePreprocessor(), imageStore },
  });
}

describe('composition root wiring (smoke)', () => {
  it('приложение собирается из production-style DI-графа без ошибок', () => {
    expect(() => buildSmokeApp()).not.toThrow();
  });

  it('GET /api/health → 200 {status:ok} без JWT', async () => {
    const res = await request(buildSmokeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('auth-роут смонтирован: GET /api/auth/me существует (без токена → 401, не 404)', async () => {
    const res = await request(buildSmokeApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('защищённый эндпоинт без токена → 401', async () => {
    const res = await request(buildSmokeApp()).get('/api/invoices');
    expect(res.status).toBe(401);
  });

  it('upload/ocr роуты смонтированы: без токена → 401 (не 404)', async () => {
    const app = buildSmokeApp();
    expect((await request(app).post('/api/invoices/upload').send({ base64: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/invoices/inv-1/ocr')).status).toBe(401);
  });
});
