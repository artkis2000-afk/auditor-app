import { describe, it, expect } from 'vitest';
import type { Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { InvoiceService, type Actor } from '../invoiceService.js';
import { DashboardService } from '../dashboardService.js';
import { ExportService } from '../exportService.js';
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
  return { ctx, inv: new InvoiceService(ctx) };
}

async function seedDuplicate(inv: InvoiceService) {
  await inv.createManual(
    { recognizedDate: '2026-01-01', supplierName: 'ООО A', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
    admin,
  );
  await inv.createManual(
    { recognizedDate: '2026-02-01', supplierName: 'ООО A', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
    admin,
  );
}

describe('DashboardService.getStats', () => {
  it('считает totals, pie, supplierPurchases, recentAnomalies', async () => {
    const { ctx, inv } = setup();
    await seedDuplicate(inv);
    const stats = await new DashboardService(ctx).getStats({ periodType: 'all' });
    expect(stats.totalInvoicesCount).toBe(2);
    expect(stats.flaggedInvoicesCount).toBe(1);
    expect(stats.flaggedPercentage).toBe(50);
    const dupPie = stats.pieData.find((p) => p.name.includes('износа'))!;
    expect(dupPie.value).toBeGreaterThanOrEqual(1);
    expect(stats.supplierPurchases.find((s) => s.name === 'ООО A')!.total).toBe(2000);
    expect(stats.recentAnomalies.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stats.chartData)).toBe(true);
  });
});

describe('ExportService', () => {
  it('exportCsv: BOM, заголовок и строки', async () => {
    const { ctx, inv } = setup();
    await seedDuplicate(inv);
    const csv = await new ExportService(ctx).exportCsv();
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Номер накладной');
    expect(csv).toContain('Фильтр');
    expect(csv.split('\r\n').length).toBeGreaterThan(1);
  });

  it('xlsxTable: подготовленные строки (без сериализации XLSX)', async () => {
    const { ctx, inv } = setup();
    await seedDuplicate(inv);
    const table = await new ExportService(ctx).xlsxTable();
    expect(table.sheetName).toBe('Аудит закупок');
    expect(table.header).toContain('Аномалии');
    expect(table.rows.length).toBeGreaterThanOrEqual(2);
  });
});
