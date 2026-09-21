import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/index.js';
import type { FirestoreGateway } from '../../db/index.js';
import { makeAuthDeps, encodeStubToken } from './_testAuth.js';

// Профиль users/{uid} создаётся лениво в authenticate; дашборд требует лишь authenticated.
const TOKEN = encodeStubToken({ uid: 'u-admin', email: 'admin@example.com', emailVerified: true, name: 'Админ' });

function buildWith(gateway: FirestoreGateway) {
  const ctx = createServiceContext(gateway);
  const app = createApp({ ctx, ...makeAuthDeps(ctx) });
  return { app, token: TOKEN };
}

function build() {
  return buildWith(new InMemoryGateway({}));
}
const B = (t: string) => `Bearer ${t}`;

const DASHBOARD_KEYS = [
  'totalInvoicesCount',
  'flaggedInvoicesCount',
  'flaggedPercentage',
  'potentialSavings',
  'chartData',
  'pieData',
  'topPartsData',
  'recentAnomalies',
  'supplierPurchases',
];

describe('GET /api/dashboard/stats', () => {
  it('без auth → 401', async () => {
    const { app } = build();
    expect((await request(app).get('/api/dashboard/stats')).status).toBe(401);
  });

  it('valid auth → 200 и ответ соответствует DTO DashboardStats', async () => {
    const { app, token } = build();
    const res = await request(app).get('/api/dashboard/stats').set('Authorization', B(token));
    expect(res.status).toBe(200);
    for (const key of DASHBOARD_KEYS) expect(res.body).toHaveProperty(key);
    expect(Array.isArray(res.body.chartData)).toBe(true);
    expect(Array.isArray(res.body.pieData)).toBe(true);
    expect(typeof res.body.totalInvoicesCount).toBe('number');
  });

  it('корректный period (month) → 200', async () => {
    const { app, token } = build();
    const res = await request(app)
      .get('/api/dashboard/stats?periodType=month&selectedYear=2026&selectedMonth=7')
      .set('Authorization', B(token));
    expect(res.status).toBe(200);
  });

  it('невалидный period → 400', async () => {
    const { app, token } = build();
    expect((await request(app).get('/api/dashboard/stats?periodType=bogus').set('Authorization', B(token))).status).toBe(400);
  });

  it('ошибка сервиса → 500 без стека (central error mapping)', async () => {
    const throwingGateway: FirestoreGateway = {
      getAll: async () => {
        throw new Error('db down');
      },
      getById: async () => null,
      set: async () => {},
      delete: async () => {},
      commitBatch: async () => {},
    };
    const { app, token } = buildWith(throwingGateway);
    const res = await request(app).get('/api/dashboard/stats').set('Authorization', B(token));
    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.stack).toBeUndefined();
    expect(res.body.error).not.toContain('db down'); // не раскрываем внутреннюю ошибку
  });
});
