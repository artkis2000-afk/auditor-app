import { describe, it, expect } from 'vitest';
import type { Invoice, InvoiceItem } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { InvoiceItemService } from '../invoiceItemService.js';
import type { Actor } from '../invoiceService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const admin: Actor = { id: 'u-admin', username: 'admin' };

function invoiceDoc(p: Partial<Invoice> & { id: string; recognizedDate: string }): Invoice {
  return {
    imagePath: '', status: 'confirmed', uploadedBy: 'u-admin', supplierId: null, supplierName: 'ООО X',
    rawSupplierName: null, totalSum: 0, isReconciled: false, createdAt: TS, updatedAt: TS, deletedAt: null, ...p,
  };
}
function itemDoc(p: Partial<InvoiceItem> & { id: string; invoiceId: string; unitPrice: number }): InvoiceItem {
  return { nomenclatureId: null, rawName: '', quantity: 1, lineSum: p.unitPrice, matchedNomenclatureId: null, ...p };
}

describe('InvoiceItemService.getAll', () => {
  it('подставляет recognizedDate/supplierName из накладной; включает складские WH-*', async () => {
    const gw = new InMemoryGateway({
      invoices: [invoiceDoc({ id: 'inv-1', recognizedDate: '2026-07-01' })],
      invoiceItems: [
        itemDoc({ id: 'ii-1', invoiceId: 'inv-1', unitPrice: 100 }),
        itemDoc({ id: 'ii-wh', invoiceId: 'WH-1', unitPrice: 50, vehicleId: 'GENERAL', recognizedDate: '2026-08-01', supplierName: 'Общий склад (масло)' }),
      ],
    });
    const svc = new InvoiceItemService(createServiceContext(gw, { clock: fixedClock(), ids: countingIds() }));
    const items = await svc.getAll();
    const fromInvoice = items.find((i) => i.id === 'ii-1')!;
    expect(fromInvoice.recognizedDate).toBe('2026-07-01');
    expect(fromInvoice.supplierName).toBe('ООО X');
    const wh = items.find((i) => i.id === 'ii-wh')!;
    expect(wh.recognizedDate).toBe('2026-08-01');
  });

  it('исключает позиции удалённых накладных (кроме WH-*)', async () => {
    const gw = new InMemoryGateway({
      invoices: [invoiceDoc({ id: 'inv-del', recognizedDate: '2026-07-01', deletedAt: TS })],
      invoiceItems: [itemDoc({ id: 'ii-x', invoiceId: 'inv-del', unitPrice: 100 })],
    });
    const svc = new InvoiceItemService(createServiceContext(gw));
    expect(await svc.getAll()).toHaveLength(0);
  });
});

describe('InvoiceItemService.updatePlacement', () => {
  it('меняет vehicleId/placement, пишет audit item_placement_update', async () => {
    const gw = new InMemoryGateway({
      invoices: [invoiceDoc({ id: 'inv-1', recognizedDate: '2026-07-01' })],
      invoiceItems: [itemDoc({ id: 'ii-1', invoiceId: 'inv-1', unitPrice: 100, matchedNomenclatureId: null })],
    });
    const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
    const svc = new InvoiceItemService(ctx);
    const res = await svc.updatePlacement('ii-1', { vehicleId: 'v-volvo', truckPlacement: 'cabin' }, admin);
    expect(res.item.vehicleId).toBe('v-volvo');
    expect(res.item.truckPlacement).toBe('cabin');
    const stored = await ctx.repositories.invoiceItems.getById('ii-1');
    expect(stored!.truckPlacement).toBe('cabin');
    expect((await ctx.repositories.auditLogs.getAll()).some((l) => l.action === 'item_placement_update')).toBe(true);
  });

  it('несуществующая позиция → NOT_FOUND', async () => {
    const svc = new InvoiceItemService(createServiceContext(new InMemoryGateway()));
    await expect(svc.updatePlacement('nope', { vehicleId: 'v-volvo' }, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
