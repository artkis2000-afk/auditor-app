import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/index.js';
import { seedPrincipals, makeAuthDeps } from './_testAuth.js';

async function build() {
  const gw = new InMemoryGateway({});
  const ctx = createServiceContext(gw);
  const app = createApp({ ctx, ...makeAuthDeps(ctx) });
  const tokens = await seedPrincipals(ctx, {
    admin: { id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' },
    viewer: { id: 'u-viewer', username: 'viewer', role: 'viewer', fullName: 'Аудитор' },
  });
  return { app, tokens };
}
const B = (t: string) => `Bearer ${t}`;

describe('Suppliers routes', () => {
  it('GET без auth → 401; с auth → 200 массив', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/suppliers')).status).toBe(401);
    const res = await request(app).get('/api/suppliers').set('Authorization', B(tokens.viewer));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('match без auth → 401; с auth → 200; массивный ?q → 400', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/suppliers/match?q=x')).status).toBe(401);
    expect((await request(app).get('/api/suppliers/match?q=x').set('Authorization', B(tokens.viewer))).status).toBe(200);
    expect((await request(app).get('/api/suppliers/match?q=a&q=b').set('Authorization', B(tokens.viewer))).status).toBe(400);
  });

  it('POST: viewer → 403; admin → 200 {success,supplier}; invalid body → 400; duplicate ИНН → 409', async () => {
    const { app, tokens } = await build();
    const body = { name: 'ООО Тест', inn: '7712345678' };
    expect((await request(app).post('/api/suppliers').set('Authorization', B(tokens.viewer)).send(body)).status).toBe(403);
    const ok = await request(app).post('/api/suppliers').set('Authorization', B(tokens.admin)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.supplier.name).toBe('ООО Тест');
    expect((await request(app).post('/api/suppliers').set('Authorization', B(tokens.admin)).send({ name: 'X' })).status).toBe(400);
    expect(
      (await request(app).post('/api/suppliers').set('Authorization', B(tokens.admin)).send({ name: 'Другой', inn: '7712345678' })).status,
    ).toBe(409);
  });

  it('PUT/DELETE: admin → 200; отсутствующий → 404; viewer DELETE → 403', async () => {
    const { app, tokens } = await build();
    const created = await request(app).post('/api/suppliers').set('Authorization', B(tokens.admin)).send({ name: 'A', inn: '111' });
    const id = created.body.supplier.id as string;
    const put = await request(app).put(`/api/suppliers/${id}`).set('Authorization', B(tokens.admin)).send({ name: 'B', inn: '111' });
    expect(put.status).toBe(200);
    expect((await request(app).put('/api/suppliers/nope').set('Authorization', B(tokens.admin)).send({ name: 'B', inn: '9' })).status).toBe(404);
    expect((await request(app).delete(`/api/suppliers/${id}`).set('Authorization', B(tokens.viewer))).status).toBe(403);
    expect((await request(app).delete(`/api/suppliers/${id}`).set('Authorization', B(tokens.admin))).status).toBe(200);
    expect((await request(app).delete('/api/suppliers/nope').set('Authorization', B(tokens.admin))).status).toBe(404);
  });
});
