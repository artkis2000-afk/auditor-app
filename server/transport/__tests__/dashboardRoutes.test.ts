import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/index.js';
import type { FirestoreGateway } from '../../db/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from '../../auth/index.js';

const SECRET = 'test-secret-not-real';
const TS = '2026-06-01T12:00:00.000Z';

function buildWith(gateway: FirestoreGateway) {
  const ctx = createServiceContext(gateway);
  const tokenService = new TokenService(SECRET);
  const authService = new AuthService(ctx, tokenService, new Sha256Hasher());
  const app = createApp({ ctx, authService, authorizationService: new AuthorizationService(), tokenService });
  const token = tokenService.create({ id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' });
  return { app, token };
}

function build() {
  const gw = new InMemoryGateway({
    users: [{ id: 'u-admin', username: 'admin', fullName: 'Админ', role: 'admin', isActive: true, createdAt: TS }],
  });
  return buildWith(gw);
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
