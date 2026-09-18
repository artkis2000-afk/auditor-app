import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { composeApp } from '../composeApp.js';
import { InMemoryGateway } from '../repositories/__tests__/inMemoryGateway.js';

/**
 * Smoke composition root: собираем приложение той же функцией composeApp(), что и index.ts,
 * но с in-memory gateway и тестовым секретом. Реального Firestore нет, записей нет —
 * проверяется только связность DI-графа и базовые контракты транспорта.
 */
function buildSmokeApp() {
  return composeApp(new InMemoryGateway(), 'smoke-secret-not-real');
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

  it('auth-роут смонтирован: POST /api/auth/login существует (не 404)', async () => {
    const res = await request(buildSmokeApp()).post('/api/auth/login').send({});
    expect(res.status).not.toBe(404);
  });

  it('защищённый эндпоинт без токена → 401', async () => {
    const res = await request(buildSmokeApp()).get('/api/invoices');
    expect(res.status).toBe(401);
  });
});
