import { describe, it, expect } from 'vitest';
import type { Invoice, InvoiceItem, Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { InvoiceService, InvoiceServiceError, type Actor } from '../invoiceService.js';
import { AuditService } from '../auditService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const actor: Actor = { id: 'u-admin', username: 'admin' };
const nomN1: Nomenclature = {
  id: 'N1',
  normalizedName: 'Фильтр',
  category: '',
  normativeServiceDays: 180,
  notes: '',
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};
const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

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

function setup(seed: Record<string, Array<{ id: string } & Record<string, unknown>>> = {}) {
  const gw = new InMemoryGateway({ nomenclature: [nomN1], vehicles: [vehVolvo], ...seed });
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { gw, ctx, svc: new InvoiceService(ctx), audit: new AuditService(ctx) };
}

describe('InvoiceService.createManual', () => {
  it('создаёт накладную, сплитит qty>1, создаёт поставщика, пишет audit', async () => {
    const { ctx, svc, audit } = setup();
    const res = await svc.createManual(
      {
        recognizedDate: '2026-02-01',
        supplierName: 'ООО Тест',
        items: [{ rawName: 'Фильтр', quantity: 2, unitPrice: 1000, lineSum: 2000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }],
      },
      actor,
    );
    expect(res.status).toBe('confirmed'); // нет предыдущих закупок

    const items = await ctx.repositories.invoiceItems.listByInvoice(res.invoiceId);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.quantity === 1 && i.lineSum === 1000)).toBe(true);

    const inv = await ctx.repositories.invoices.getById(res.invoiceId);
    expect(inv!.totalSum).toBe(2000);

    const sup = (await ctx.repositories.suppliers.getAll()).find((s) => s.name === 'ООО Тест');
    expect(sup).toBeTruthy();
    expect(sup!.inn).toMatch(/^\d{10}$/); // legacy случайный ИНН (KI-6)

    expect((await audit.list()).some((l) => l.action === 'invoice_manual_create')).toBe(true);
  });

  it('повторная закупка в пределах норматива → накладная flagged', async () => {
    const { svc, ctx } = setup();
    await svc.createManual(
      { recognizedDate: '2026-01-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
      actor,
    );
    const c = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
      actor,
    );
    expect(c.status).toBe('flagged');
    const flags = await ctx.repositories.anomalyFlags.listByInvoice(c.invoiceId);
    expect(flags.some((f) => f.flagType === 'duplicate_exceed')).toBe(true);
  });
});

describe('InvoiceService.edit', () => {
  it('заменяет позиции и пересчитывает totalSum; audit хранит старые позиции', async () => {
    const { svc, ctx, audit } = setup();
    const created = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Старое', quantity: 1, unitPrice: 500, matchedNomenclatureId: 'N1' }] },
      actor,
    );
    await svc.edit(
      created.invoiceId,
      { recognizedDate: '2026-02-01', supplierName: 'ООО Тест', items: [{ rawName: 'Новое', quantity: 1, unitPrice: 900, matchedNomenclatureId: 'N1' }] },
      actor,
    );
    const items = await ctx.repositories.invoiceItems.listByInvoice(created.invoiceId);
    expect(items).toHaveLength(1);
    expect(items[0]!.rawName).toBe('Новое');
    expect((await ctx.repositories.invoices.getById(created.invoiceId))!.totalSum).toBe(900);

    const editLog = (await audit.list()).find((l) => l.action === 'invoice_edit');
    expect(editLog).toBeTruthy();
    expect((editLog!.oldValues as { items: InvoiceItem[] }).items[0]!.rawName).toBe('Старое');
  });

  it('сверенная накладная без PIN → PIN_REQUIRED; с PIN 1308 → успех', async () => {
    const { svc } = setup();
    const created = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      actor,
    );
    await svc.reconcile([created.invoiceId], actor);

    await expect(
      svc.edit(created.invoiceId, { recognizedDate: '2026-02-01', supplierName: 'X', items: [] }, actor),
    ).rejects.toMatchObject({ code: 'PIN_REQUIRED' });

    await expect(
      svc.edit(created.invoiceId, { recognizedDate: '2026-02-01', supplierName: 'X', items: [], pin: '1308' }, actor),
    ).resolves.toBeTruthy();
  });
});

describe('InvoiceService.confirm', () => {
  it('подтверждение draft с дубликатом → flagged', async () => {
    const { svc, ctx } = setup({
      invoices: [
        invoiceDoc({ id: 'P', recognizedDate: '2026-01-01' }),
        invoiceDoc({ id: 'D', recognizedDate: '2026-02-01', status: 'draft' }),
      ],
      invoiceItems: [
        itemDoc({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        itemDoc({ id: 'di', invoiceId: 'D', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
    });
    const res = await svc.confirm('D', actor);
    expect(res.status).toBe('flagged');
    expect((await ctx.repositories.invoices.getById('D'))!.status).toBe('flagged');
  });
});

describe('InvoiceService.delete', () => {
  it('soft-delete накладной + hard-delete позиций; audit хранит позиции', async () => {
    const { svc, ctx, gw, audit } = setup();
    const created = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      actor,
    );
    await svc.delete(created.invoiceId, actor);

    const inv = await ctx.repositories.invoices.getById(created.invoiceId);
    expect(inv!.deletedAt).not.toBeNull(); // soft
    expect(await ctx.repositories.invoiceItems.listByInvoice(created.invoiceId)).toHaveLength(0); // hard
    expect(gw.raw('invoiceItems')).toHaveLength(0);

    const delLog = (await audit.list()).find((l) => l.action === 'invoice_delete');
    expect((delLog!.oldValues as { items: InvoiceItem[] }).items).toHaveLength(1);
  });

  it('сверенная накладная без PIN → PIN_REQUIRED', async () => {
    const { svc } = setup();
    const created = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      actor,
    );
    await svc.reconcile([created.invoiceId], actor);
    await expect(svc.delete(created.invoiceId, actor)).rejects.toBeInstanceOf(InvoiceServiceError);
    await expect(svc.delete(created.invoiceId, actor, '1308')).resolves.toEqual({ success: true });
  });
});

describe('InvoiceService.bulkDelete (KI-4: с проверкой PIN)', () => {
  it('пакет со сверенной накладной без PIN → PIN_REQUIRED (отличие от legacy)', async () => {
    const { svc } = setup();
    const a = await svc.createManual({ recognizedDate: '2026-02-01', items: [{ rawName: 'A', quantity: 1, unitPrice: 100 }] }, actor);
    const b = await svc.createManual({ recognizedDate: '2026-02-02', items: [{ rawName: 'B', quantity: 1, unitPrice: 100 }] }, actor);
    await svc.reconcile([b.invoiceId], actor);

    await expect(svc.bulkDelete([a.invoiceId, b.invoiceId], actor)).rejects.toMatchObject({ code: 'PIN_REQUIRED' });

    const res = await svc.bulkDelete([a.invoiceId, b.invoiceId], actor, '1308');
    expect(res.deletedCount).toBe(2);
  });

  it('обычный пакет без сверенных удаляется без PIN', async () => {
    const { svc, ctx } = setup();
    const a = await svc.createManual({ recognizedDate: '2026-02-01', items: [{ rawName: 'A', quantity: 1, unitPrice: 100 }] }, actor);
    const b = await svc.createManual({ recognizedDate: '2026-02-02', items: [{ rawName: 'B', quantity: 1, unitPrice: 100 }] }, actor);
    const res = await svc.bulkDelete([a.invoiceId, b.invoiceId], actor);
    expect(res.deletedCount).toBe(2);
    expect((await ctx.repositories.invoices.getById(a.invoiceId))!.deletedAt).not.toBeNull();
  });
});

describe('InvoiceService.reconcile', () => {
  it('помечает isReconciled + confirmed, флаги resolved с resolvedBy=username', async () => {
    const { svc, ctx } = setup();
    await svc.createManual(
      { recognizedDate: '2026-01-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
      actor,
    );
    const c = await svc.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Фильтр', quantity: 1, unitPrice: 1000, matchedNomenclatureId: 'N1', vehicleId: 'v-volvo' }] },
      actor,
    );
    expect(c.status).toBe('flagged');

    const res = await svc.reconcile([c.invoiceId], actor);
    expect(res.reconciledCount).toBe(1);

    const inv = await ctx.repositories.invoices.getById(c.invoiceId);
    expect(inv!.isReconciled).toBe(true);
    expect(inv!.status).toBe('confirmed');

    const flags = await ctx.repositories.anomalyFlags.listByInvoice(c.invoiceId);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.isResolved && f.resolvedBy === 'admin')).toBe(true);
  });
});
