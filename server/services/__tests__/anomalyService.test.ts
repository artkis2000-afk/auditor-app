import { describe, it, expect } from 'vitest';
import type { Invoice, InvoiceItem, Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { AnomalyService } from '../anomalyService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

function invoiceDoc(p: Partial<Invoice> & { id: string; recognizedDate: string }): Invoice {
  return {
    imagePath: '',
    status: 'confirmed',
    uploadedBy: 'u-admin',
    supplierId: null,
    supplierName: null,
    rawSupplierName: null,
    totalSum: 0,
    isReconciled: false,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...p,
  };
}
function itemDoc(p: Partial<InvoiceItem> & { id: string; invoiceId: string; unitPrice: number }): InvoiceItem {
  return { nomenclatureId: null, rawName: '', quantity: 1, lineSum: p.unitPrice, matchedNomenclatureId: null, ...p };
}
const nomDoc = (id: string, days: number): Nomenclature => ({
  id,
  normalizedName: id,
  category: '',
  normativeServiceDays: days,
  notes: '',
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
});
const vehDoc: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

function makeSvc(seed: Record<string, Array<{ id: string } & Record<string, unknown>>>) {
  const gw = new InMemoryGateway(seed);
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { gw, ctx, svc: new AnomalyService(ctx) };
}

describe('AnomalyService.recalculateAll — запись флагов и статусов', () => {
  it('дубликат: пишет флаг на ci, C→flagged, P→confirmed', async () => {
    const { ctx, svc } = makeSvc({
      invoices: [invoiceDoc({ id: 'P', recognizedDate: '2026-01-01' }), invoiceDoc({ id: 'C', recognizedDate: '2026-02-01' })],
      invoiceItems: [
        itemDoc({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        itemDoc({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      nomenclature: [nomDoc('N1', 180)],
      vehicles: [vehDoc],
    });

    await svc.recalculateAll();

    const flags = await ctx.repositories.anomalyFlags.getAll();
    expect(flags).toHaveLength(1);
    expect(flags[0]!.flagType).toBe('duplicate_exceed');
    expect(flags[0]!.invoiceItemId).toBe('ci');
    expect((await ctx.repositories.invoices.getById('C'))!.status).toBe('flagged');
    expect((await ctx.repositories.invoices.getById('P'))!.status).toBe('confirmed');
  });

  it('сохраняет resolved: ранее разрешённый флаг остаётся resolved, C→confirmed', async () => {
    const { ctx, svc } = makeSvc({
      invoices: [invoiceDoc({ id: 'P', recognizedDate: '2026-01-01' }), invoiceDoc({ id: 'C', recognizedDate: '2026-02-01' })],
      invoiceItems: [
        itemDoc({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        itemDoc({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      nomenclature: [nomDoc('N1', 180)],
      vehicles: [vehDoc],
      anomalyFlags: [
        {
          id: 'af-old',
          invoiceId: 'C',
          invoiceItemId: 'ci',
          relatedInvoiceId: 'P',
          flagType: 'duplicate_exceed',
          details: 'ранее',
          severity: 'high',
          isResolved: true,
          resolvedBy: 'boss',
          resolvedAt: '2026-02-05T00:00:00.000Z',
          createdAt: TS,
        },
      ],
    });

    await svc.recalculateAll();

    const flags = await ctx.repositories.anomalyFlags.getAll();
    expect(flags).toHaveLength(1);
    expect(flags[0]!.isResolved).toBe(true);
    expect(flags[0]!.resolvedBy).toBe('boss');
    expect(await ctx.repositories.anomalyFlags.getById('af-old')).toBeNull(); // старый удалён
    expect((await ctx.repositories.invoices.getById('C'))!.status).toBe('confirmed');
  });
});

describe('AnomalyService.recalculateForChange — инкрементально', () => {
  it('append новой накладной → C2 flagged, всего 2 флага', async () => {
    const { ctx, svc } = makeSvc({
      invoices: [invoiceDoc({ id: 'A', recognizedDate: '2026-01-01' }), invoiceDoc({ id: 'B', recognizedDate: '2026-02-01' })],
      invoiceItems: [
        itemDoc({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        itemDoc({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      nomenclature: [nomDoc('N1', 180)],
      vehicles: [vehDoc],
    });

    await svc.recalculateAll(); // база: B flagged

    // добавляем C2 (как будто создана)
    await ctx.repositories.invoices.upsert(invoiceDoc({ id: 'C2', recognizedDate: '2026-03-01' }));
    await ctx.repositories.invoiceItems.upsert(
      itemDoc({ id: 'c2i', invoiceId: 'C2', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    );

    const res = await svc.recalculateForChange({
      kind: 'invoice_appended',
      invoiceId: 'C2',
      date: '2026-03-01',
      nomenclatureIds: ['N1'],
    });
    expect(res.scope.mode).toBe('local');

    const flags = await ctx.repositories.anomalyFlags.getAll();
    expect(flags).toHaveLength(2);
    expect((await ctx.repositories.invoices.getById('C2'))!.status).toBe('flagged');
  });

  it('повышение порога (settings_changed) → флаг удаляется, B→confirmed', async () => {
    const { ctx, svc } = makeSvc({
      invoices: [
        invoiceDoc({ id: 'A', recognizedDate: '2026-01-01', supplierName: 'ООО Тест' }),
        invoiceDoc({ id: 'B', recognizedDate: '2026-06-01', supplierName: 'ООО Тест' }),
      ],
      invoiceItems: [
        itemDoc({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
        itemDoc({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', unitPrice: 1200 }),
      ],
      nomenclature: [nomDoc('N1', 0)],
      vehicles: [vehDoc],
    });

    await svc.recalculateAll();
    expect((await ctx.repositories.anomalyFlags.getAll()).length).toBeGreaterThan(0); // при пороге 10 есть флаг

    await ctx.repositories.settings.set({ anomalyThreshold: 50, duplicateDays: 180, aiOcrEngine: 'gemini' });
    const res = await svc.recalculateForChange({ kind: 'settings_changed' });
    expect(res.scope.mode).toBe('global');

    expect(await ctx.repositories.anomalyFlags.getAll()).toHaveLength(0);
    expect((await ctx.repositories.invoices.getById('B'))!.status).toBe('confirmed');
  });
});
