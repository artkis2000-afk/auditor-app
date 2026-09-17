import { describe, it, expect } from 'vitest';
import type { Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { InvoiceService, type Actor } from '../invoiceService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const admin: Actor = { id: 'u-admin', username: 'admin' };
const nomN1: Nomenclature = {
  id: 'N1', normalizedName: 'Фильтр', category: '', normativeServiceDays: 180, notes: '', createdAt: TS, updatedAt: TS, deletedAt: null,
};
const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

function setup() {
  const gw = new InMemoryGateway({
    users: [{ id: 'u-admin', username: 'admin', fullName: 'Админ', role: 'admin', isActive: true, createdAt: TS }],
    nomenclature: [nomN1],
    vehicles: [vehVolvo],
  });
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { ctx, svc: new InvoiceService(ctx) };
}

async function seedDuplicate(svc: InvoiceService) {
  await svc.createManual(
    { recognizedDate: '2026-01-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
    admin,
  );
  const c = await svc.createManual(
    { recognizedDate: '2026-02-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
    admin,
  );
  return c.invoiceId;
}

describe('InvoiceService.list', () => {
  it('возвращает накладные по убыванию даты с supplierName/uploaderName/flagsCount/items', async () => {
    const { svc } = setup();
    const cId = await seedDuplicate(svc);
    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.recognizedDate >= list[1]!.recognizedDate).toBe(true);
    const c = list.find((i) => i.id === cId)!;
    expect(c.uploaderName).toBe('Админ');
    expect(c.flagsCount).toBeGreaterThanOrEqual(1);
    expect(c.items[0]!.rawName).toBe('Фильтр');
    expect('imagePath' in c).toBe(false); // imagePath не входит в бизнес-данные
  });

  it('фильтр по статусу', async () => {
    const { svc } = setup();
    await seedDuplicate(svc);
    expect((await svc.list({ status: 'flagged' })).every((i) => i.status === 'flagged')).toBe(true);
  });
});

describe('InvoiceService.getById', () => {
  it('возвращает деталь с suggestions/flags/supplierName/uploaderName', async () => {
    const { svc } = setup();
    const cId = await seedDuplicate(svc);
    const detail = await svc.getById(cId);
    expect(detail).not.toBeNull();
    expect(detail!.items[0]!.suggestions.some((s) => s.nomenclatureId === 'N1')).toBe(true);
    expect(detail!.flags.length).toBeGreaterThanOrEqual(1);
    expect(detail!.uploaderName).toBe('Админ');
  });

  it('удалённая/несуществующая → null', async () => {
    const { svc } = setup();
    expect(await svc.getById('nope')).toBeNull();
  });
});

describe('InvoiceService.approveFlag / approveAllFlags', () => {
  it('approveFlag: флаг resolved, статус накладной confirmed, audit', async () => {
    const { ctx, svc } = setup();
    const cId = await seedDuplicate(svc);
    const flag = (await ctx.repositories.anomalyFlags.getAll()).find((f) => f.invoiceId === cId)!;
    const res = await svc.approveFlag(cId, { flagId: flag.id }, admin);
    expect(res.invoiceStatus).toBe('confirmed');
    expect((await ctx.repositories.invoices.getById(cId))!.status).toBe('confirmed');
    const flags = await ctx.repositories.anomalyFlags.getAll();
    expect(flags.filter((f) => f.invoiceId === cId).every((f) => f.isResolved)).toBe(true);
    expect((await ctx.repositories.auditLogs.getAll()).some((l) => l.action === 'invoice_approve_flag')).toBe(true);
  });

  it('approveFlag: несуществующий флаг → NOT_FOUND', async () => {
    const { svc } = setup();
    const cId = await seedDuplicate(svc);
    await expect(svc.approveFlag(cId, { flagId: 'zzz' }, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('approveAllFlags: все флаги resolved, статус confirmed', async () => {
    const { ctx, svc } = setup();
    const cId = await seedDuplicate(svc);
    const res = await svc.approveAllFlags(cId, admin);
    expect(res.status).toBe('confirmed');
    expect(res.flags.every((f) => f.isResolved)).toBe(true);
    expect((await ctx.repositories.auditLogs.getAll()).some((l) => l.action === 'invoice_approve_all_flags')).toBe(true);
  });
});
