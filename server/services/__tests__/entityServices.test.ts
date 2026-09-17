import { describe, it, expect } from 'vitest';
import type { Invoice, InvoiceItem, Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { SupplierService } from '../supplierService.js';
import { NomenclatureService } from '../nomenclatureService.js';
import { WarehouseService } from '../warehouseService.js';
import { VehicleService } from '../vehicleService.js';
import { SettingsService } from '../settingsService.js';
import { ServiceError } from '../errors.js';
import type { Actor } from '../invoiceService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const admin: Actor = { id: 'u-admin', username: 'admin' };
const boss: Actor = { id: 'u-boss', username: 'boss' };

function ctxWith(seed: Record<string, Array<{ id: string } & Record<string, unknown>>> = {}) {
  const gw = new InMemoryGateway(seed);
  return createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
}

describe('SupplierService', () => {
  it('create проверяет обязательные поля и уникальность ИНН', async () => {
    const ctx = ctxWith();
    const svc = new SupplierService(ctx);
    await expect(svc.create({ name: '', inn: '1' }, admin)).rejects.toBeInstanceOf(ServiceError);
    const s = await svc.create({ name: 'ООО Тест', inn: '7712345678' }, admin);
    expect(s.id).toBeTruthy();
    await expect(svc.create({ name: 'Другой', inn: '7712345678' }, admin)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('update и softDelete', async () => {
    const ctx = ctxWith();
    const svc = new SupplierService(ctx);
    const s = await svc.create({ name: 'A', inn: '111', legalAddress: 'x' }, admin);
    const upd = await svc.update(s.id, { name: 'B', inn: '111', isApproved: false }, admin);
    expect(upd.name).toBe('B');
    await svc.softDelete(s.id, admin);
    expect((await svc.list()).length).toBe(0);
  });

  it('match подбирает по имени', async () => {
    const ctx = ctxWith();
    const svc = new SupplierService(ctx);
    await svc.create({ name: 'ООО "АвтоДетали"', inn: '111' }, admin);
    const m = await svc.match('АвтоДетали');
    expect(m[0]!.score).toBeGreaterThanOrEqual(0.75);
  });
});

describe('NomenclatureService', () => {
  it('норматив != 0 требует boss', async () => {
    const ctx = ctxWith();
    const svc = new NomenclatureService(ctx);
    await expect(svc.create({ normalizedName: 'Фильтр', normativeServiceDays: 180 }, admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const n = await svc.create({ normalizedName: 'Фильтр', normativeServiceDays: 180, aliases: ['Ф'] }, boss);
    expect(n.normativeServiceDays).toBe(180);
    expect(n.aliases).toEqual(['Ф']);
  });

  it('list авто-досоздаёт номенклатуру из позиций накладных (KI-10)', async () => {
    const inv: Invoice & Record<string, unknown> = {
      id: 'inv-1',
      imagePath: '',
      recognizedDate: '2026-07-01',
      status: 'confirmed',
      uploadedBy: 'u',
      supplierId: null,
      supplierName: 'ООО X',
      rawSupplierName: null,
      totalSum: 0,
      isReconciled: false,
      createdAt: TS,
      updatedAt: TS,
      deletedAt: null,
    };
    const item: InvoiceItem & Record<string, unknown> = {
      id: 'ii-1',
      invoiceId: 'inv-1',
      nomenclatureId: null,
      rawName: 'Деталь без каталога',
      quantity: 1,
      unitPrice: 100,
      lineSum: 100,
      matchedNomenclatureId: null,
    };
    const ctx = ctxWith({ invoices: [inv], invoiceItems: [item] });
    const svc = new NomenclatureService(ctx);
    const list = await svc.list();
    expect(list.some((n) => n.normalizedName === 'Деталь без каталога')).toBe(true);
    const updatedItem = await ctx.repositories.invoiceItems.getById('ii-1');
    expect(updatedItem!.matchedNomenclatureId).toMatch(/^nom-auto/);
  });
});

describe('WarehouseService', () => {
  it('add создаёт складскую позицию GENERAL/WH-*', async () => {
    const ctx = ctxWith();
    const svc = new WarehouseService(ctx);
    const item = await svc.add({ rawName: 'Антифриз', quantity: 10, unitPrice: 500 }, admin);
    expect(item.vehicleId).toBe('GENERAL');
    expect(item.invoiceId).toMatch(/^WH-/);
    expect(item.lineSum).toBe(5000);
  });

  it('allocate частично: остаток уменьшается, создаётся списанная позиция', async () => {
    const ctx = ctxWith();
    const svc = new WarehouseService(ctx);
    const item = await svc.add({ rawName: 'Масло', quantity: 10, unitPrice: 100 }, admin);
    await svc.allocate({ itemId: item.id, targetVehicleId: 'v-volvo', allocateQuantity: 3 }, admin);
    const remaining = await ctx.repositories.invoiceItems.getById(item.id);
    expect(remaining!.quantity).toBe(7);
    const all = await ctx.repositories.invoiceItems.getAll();
    const allocated = all.find((i) => i.vehicleId === 'v-volvo');
    expect(allocated!.quantity).toBe(3);
    expect(allocated!.lineSum).toBe(300);
  });

  it('allocate некорректное количество → VALIDATION', async () => {
    const ctx = ctxWith();
    const svc = new WarehouseService(ctx);
    const item = await svc.add({ rawName: 'X', quantity: 5, unitPrice: 100 }, admin);
    await expect(svc.allocate({ itemId: item.id, targetVehicleId: 'v-volvo', allocateQuantity: 99 }, admin)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('VehicleService', () => {
  const nom = (id: string, vehicleId: string, placement: string): Nomenclature & Record<string, unknown> => ({
    id,
    normalizedName: id,
    category: '',
    normativeServiceDays: 0,
    notes: '',
    truckPlacement: placement as Nomenclature['truckPlacement'],
    vehicleId,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });

  it('upsert create/edit', async () => {
    const ctx = ctxWith();
    const svc = new VehicleService(ctx);
    const v = await svc.upsert({ name: 'Тест', plate: 'A 001 AA 77' }, admin);
    expect(v.id).toMatch(/^v-custom/);
    const edited = await svc.upsert({ id: v.id, name: 'Тест2', plate: 'A 001 AA 77' }, admin);
    expect(edited.name).toBe('Тест2');
  });

  it('delete отвязывает номенклатуру этой машины', async () => {
    const ctx = ctxWith({
      vehicles: [{ id: 'v-x', name: 'X', plate: 'P' }],
      nomenclature: [nom('n1', 'v-x', 'cabin')],
    });
    const svc = new VehicleService(ctx);
    await svc.delete('v-x', admin);
    const n = await ctx.repositories.nomenclature.getById('n1');
    expect(n!.vehicleId ?? null).toBeNull();
  });

  it('deleteTrailer отвязывает детали прицепных узлов', async () => {
    const ctx = ctxWith({
      vehicles: [{ id: 'v-x', name: 'X', plate: 'P', trailerPlate: 'T' }],
      nomenclature: [nom('nt', 'v-x', 'trailer_1_left'), nom('nc', 'v-x', 'cabin')],
    });
    const svc = new VehicleService(ctx);
    await svc.deleteTrailer('v-x', admin);
    expect((await ctx.repositories.nomenclature.getById('nt'))!.vehicleId ?? null).toBeNull(); // прицеп отвязан
    expect((await ctx.repositories.nomenclature.getById('nc'))!.vehicleId).toBe('v-x'); // кабина осталась
  });

  it('swapTrailers меняет привязку прицепных деталей местами', async () => {
    const ctx = ctxWith({
      nomenclature: [nom('a', 'v-1', 'trailer_1_left'), nom('b', 'v-2', 'trailer_1_right')],
    });
    const svc = new VehicleService(ctx);
    await svc.swapTrailers({ sourceVehicleId: 'v-1', targetVehicleId: 'v-2' }, admin);
    expect((await ctx.repositories.nomenclature.getById('a'))!.vehicleId).toBe('v-2');
    expect((await ctx.repositories.nomenclature.getById('b'))!.vehicleId).toBe('v-1');
  });

  it('toggleExclusion добавляет и удаляет исключение', async () => {
    const ctx = ctxWith();
    const svc = new VehicleService(ctx);
    let list = await svc.toggleExclusion({ vehicleId: 'v-1', year: 2026, month: 7, excluded: true }, admin);
    expect(list).toHaveLength(1);
    list = await svc.toggleExclusion({ vehicleId: 'v-1', year: 2026, month: 7, excluded: false }, admin);
    expect(list).toHaveLength(0);
  });
});

describe('SettingsService', () => {
  it('get дефолты; update мержит и парсит email сервисного аккаунта', async () => {
    const ctx = ctxWith();
    const svc = new SettingsService(ctx);
    expect((await svc.get()).anomalyThreshold).toBe(10);
    const upd = await svc.update(
      { anomalyThreshold: 25, googleServiceAccountJson: JSON.stringify({ client_email: 'sa@x.iam' }) },
      admin,
    );
    expect(upd.anomalyThreshold).toBe(25);
    expect(upd.centralGoogleEmail).toBe('sa@x.iam');
  });
});
