import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Vehicle } from '../../../shared/index.js';
import { createApp } from '../app.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../../services/index.js';
import { seedPrincipals, makeAuthDeps } from './_testAuth.js';

const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

async function build() {
  const gw = new InMemoryGateway({ vehicles: [vehVolvo] });
  const ctx = createServiceContext(gw);
  const app = createApp({ ctx, ...makeAuthDeps(ctx) });
  const tokens = await seedPrincipals(ctx, {
    admin: { id: 'u-admin', username: 'admin', role: 'admin', fullName: 'Админ' },
    viewer: { id: 'u-viewer', username: 'viewer', role: 'viewer', fullName: 'Аудитор' },
  });
  return { app, tokens };
}
const B = (t: string) => `Bearer ${t}`;
const post = (app: Express, p: string, t: string, body?: object) => request(app).post(p).set('Authorization', B(t)).send(body ?? {});

describe('Vehicles routes', () => {
  it('GET без auth → 401; с auth → 200', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/vehicles')).status).toBe(401);
    expect((await request(app).get('/api/vehicles').set('Authorization', B(tokens.viewer))).status).toBe(200);
  });

  it('POST/DELETE: viewer → 403; admin → 200; invalid body → 400', async () => {
    const { app, tokens } = await build();
    expect((await post(app, '/api/vehicles', tokens.viewer, { name: 'Т', plate: 'A 1' })).status).toBe(403);
    const created = await post(app, '/api/vehicles', tokens.admin, { name: 'Тест', plate: 'A 001 AA 77' });
    expect(created.status).toBe(200);
    const id = created.body.vehicle.id as string;
    expect((await post(app, '/api/vehicles', tokens.admin, { name: 'X' })).status).toBe(400);
    expect((await request(app).delete(`/api/vehicles/${id}`).set('Authorization', B(tokens.viewer))).status).toBe(403);
    expect((await request(app).delete(`/api/vehicles/${id}`).set('Authorization', B(tokens.admin))).status).toBe(200);
  });

  it('trailer add/delete: viewer → 403; admin → 200', async () => {
    const { app, tokens } = await build();
    expect((await post(app, '/api/vehicles/v-volvo/trailer', tokens.viewer, { trailerPlate: 'T 1' })).status).toBe(403);
    expect((await post(app, '/api/vehicles/v-volvo/trailer', tokens.admin, { trailerPlate: 'T 1' })).status).toBe(200);
    expect((await request(app).delete('/api/vehicles/v-volvo/trailer').set('Authorization', B(tokens.viewer))).status).toBe(403);
    expect((await request(app).delete('/api/vehicles/v-volvo/trailer').set('Authorization', B(tokens.admin))).status).toBe(200);
  });

  it('swap-trailers: viewer → 403; admin → 200', async () => {
    const { app, tokens } = await build();
    const body = { sourceVehicleId: 'v-volvo', targetVehicleId: 'v-scania' };
    expect((await post(app, '/api/vehicles/swap-trailers', tokens.viewer, body)).status).toBe(403);
    expect((await post(app, '/api/vehicles/swap-trailers', tokens.admin, body)).status).toBe(200);
  });
});

describe('Vehicle exclusions routes', () => {
  it('GET без auth → 401; POST viewer → 403; POST admin → 200; invalid body → 400', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/vehicle-exclusions')).status).toBe(401);
    expect((await request(app).get('/api/vehicle-exclusions').set('Authorization', B(tokens.viewer))).status).toBe(200);
    const body = { vehicleId: 'v-volvo', year: 2026, month: 7, excluded: true };
    expect((await post(app, '/api/vehicle-exclusions', tokens.viewer, body)).status).toBe(403);
    expect((await post(app, '/api/vehicle-exclusions', tokens.admin, body)).status).toBe(200);
    expect((await post(app, '/api/vehicle-exclusions', tokens.admin, {})).status).toBe(400);
  });
});

describe('Warehouse routes', () => {
  it('add: no auth → 401; viewer → 403; admin → 200; invalid body → 400', async () => {
    const { app, tokens } = await build();
    expect((await request(app).post('/api/warehouse/add').send({ rawName: 'X', quantity: 1, unitPrice: 1 })).status).toBe(401);
    expect((await post(app, '/api/warehouse/add', tokens.viewer, { rawName: 'X', quantity: 1, unitPrice: 1 })).status).toBe(403);
    const ok = await post(app, '/api/warehouse/add', tokens.admin, { rawName: 'Антифриз', quantity: 10, unitPrice: 500 });
    expect(ok.status).toBe(200);
    expect(ok.body.item.vehicleId).toBe('GENERAL');
    expect((await post(app, '/api/warehouse/add', tokens.admin, {})).status).toBe(400);
  });

  it('allocate: admin → 200; неверное кол-во → 400; отсутствующий товар → 404', async () => {
    const { app, tokens } = await build();
    const item = (await post(app, '/api/warehouse/add', tokens.admin, { rawName: 'Масло', quantity: 10, unitPrice: 100 })).body.item;
    expect((await post(app, '/api/warehouse/allocate', tokens.admin, { itemId: item.id, targetVehicleId: 'v-volvo', allocateQuantity: 3 })).status).toBe(200);
    expect((await post(app, '/api/warehouse/allocate', tokens.admin, { itemId: item.id, targetVehicleId: 'v-volvo', allocateQuantity: 99 })).status).toBe(400);
    expect((await post(app, '/api/warehouse/allocate', tokens.admin, { itemId: 'nope', targetVehicleId: 'v-volvo', allocateQuantity: 1 })).status).toBe(404);
  });
});

describe('Invoice-items routes', () => {
  it('GET no auth → 401; auth → 200', async () => {
    const { app, tokens } = await build();
    expect((await request(app).get('/api/invoice-items')).status).toBe(401);
    expect((await request(app).get('/api/invoice-items').set('Authorization', B(tokens.viewer))).status).toBe(200);
  });

  it('placement: viewer → 403; admin → 200; invalid body → 400; missing item → 404', async () => {
    const { app, tokens } = await build();
    const item = (await post(app, '/api/warehouse/add', tokens.admin, { rawName: 'Гайка', quantity: 5, unitPrice: 10 })).body.item;
    expect(
      (await request(app).put(`/api/invoice-items/${item.id}/placement`).set('Authorization', B(tokens.viewer)).send({ vehicleId: 'v-volvo' })).status,
    ).toBe(403);
    expect(
      (await request(app).put(`/api/invoice-items/${item.id}/placement`).set('Authorization', B(tokens.admin)).send({ vehicleId: 'v-volvo', truckPlacement: 'cabin' })).status,
    ).toBe(200);
    expect(
      (await request(app).put(`/api/invoice-items/${item.id}/placement`).set('Authorization', B(tokens.admin)).send({ truckPlacement: 'bogus' })).status,
    ).toBe(400);
    expect(
      (await request(app).put('/api/invoice-items/nope/placement').set('Authorization', B(tokens.admin)).send({ vehicleId: 'v-volvo' })).status,
    ).toBe(404);
  });
});
