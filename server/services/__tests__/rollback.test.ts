import { describe, it, expect } from 'vitest';
import type { Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { AuditService } from '../auditService.js';
import { InvoiceService } from '../invoiceService.js';
import { SupplierService } from '../supplierService.js';
import { NomenclatureService } from '../nomenclatureService.js';
import { SettingsService } from '../settingsService.js';
import { ServiceError } from '../errors.js';
import type { Actor } from '../invoiceService.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const admin: Actor = { id: 'u-admin', username: 'admin' };
const boss: Actor = { id: 'u-boss', username: 'boss' };
const nomN1: Nomenclature = {
  id: 'N1', normalizedName: 'Фильтр', category: '', normativeServiceDays: 180, notes: '', createdAt: TS, updatedAt: TS, deletedAt: null,
};
const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

function make() {
  const gw = new InMemoryGateway({ nomenclature: [nomN1], vehicles: [vehVolvo] });
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { ctx, audit: new AuditService(ctx) };
}

async function logId(ctx: ReturnType<typeof make>['ctx'], action: string, entityId?: string): Promise<string> {
  const logs = await new AuditService(ctx).list();
  const found = logs.find((l) => l.action === action && (entityId ? l.entityId === entityId : true));
  if (!found) throw new Error(`log ${action} not found`);
  return found.id;
}

describe('AuditService.rollback', () => {
  it('invoice_edit → восстанавливает шапку и позиции', async () => {
    const { ctx, audit } = make();
    const inv = new InvoiceService(ctx);
    const created = await inv.createManual(
      { recognizedDate: '2026-02-01', supplierName: 'ООО A', items: [{ rawName: 'Старое', quantity: 1, unitPrice: 500, matchedNomenclatureId: 'N1' }] },
      admin,
    );
    await inv.edit(
      created.invoiceId,
      { recognizedDate: '2026-02-01', supplierName: 'ООО B', items: [{ rawName: 'Новое', quantity: 1, unitPrice: 900, matchedNomenclatureId: 'N1' }] },
      admin,
    );

    await audit.rollback(await logId(ctx, 'invoice_edit', created.invoiceId), admin);

    const invoice = await ctx.repositories.invoices.getById(created.invoiceId);
    expect(invoice!.supplierName).toBe('ООО A');
    expect(invoice!.totalSum).toBe(500);
    const items = await ctx.repositories.invoiceItems.listByInvoice(created.invoiceId);
    expect(items).toHaveLength(1);
    expect(items[0]!.rawName).toBe('Старое');
  });

  it('invoice_manual_create → удаляет накладную и позиции', async () => {
    const { ctx, audit } = make();
    const inv = new InvoiceService(ctx);
    const created = await inv.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      admin,
    );
    await audit.rollback(await logId(ctx, 'invoice_manual_create', created.invoiceId), admin);
    expect(await ctx.repositories.invoices.getById(created.invoiceId)).toBeNull();
    expect(await ctx.repositories.invoiceItems.listByInvoice(created.invoiceId)).toHaveLength(0);
  });

  it('invoice_delete → восстанавливает накладную и позиции', async () => {
    const { ctx, audit } = make();
    const inv = new InvoiceService(ctx);
    const created = await inv.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      admin,
    );
    await inv.delete(created.invoiceId, admin);
    await audit.rollback(await logId(ctx, 'invoice_delete', created.invoiceId), admin);
    const invoice = await ctx.repositories.invoices.getById(created.invoiceId);
    expect(invoice!.deletedAt).toBeNull();
    expect(await ctx.repositories.invoiceItems.listByInvoice(created.invoiceId)).toHaveLength(1);
  });

  it('supplier_edit → восстанавливает прежние значения', async () => {
    const { ctx, audit } = make();
    const svc = new SupplierService(ctx);
    const s = await svc.create({ name: 'Старое имя', inn: '111' }, admin);
    await svc.update(s.id, { name: 'Новое имя', inn: '111', isApproved: true }, admin);
    await audit.rollback(await logId(ctx, 'supplier_edit', s.id), admin);
    expect((await ctx.repositories.suppliers.getById(s.id))!.name).toBe('Старое имя');
  });

  it('nomenclature_edit → восстанавливает поля и алиасы', async () => {
    const { ctx, audit } = make();
    const svc = new NomenclatureService(ctx);
    const n = await svc.create({ normalizedName: 'Деталь', aliases: ['A'] }, boss);
    await svc.update(n.id, { normalizedName: 'Деталь-изм', aliases: ['B'] }, boss);
    await audit.rollback(await logId(ctx, 'nomenclature_edit', n.id), admin);
    expect((await ctx.repositories.nomenclature.getById(n.id))!.normalizedName).toBe('Деталь');
    const aliases = await ctx.repositories.nomenclatureAliases.listByNomenclature(n.id);
    expect(aliases.map((a) => a.aliasName)).toEqual(['A']);
  });

  it('settings_update → откат падает (KI-12: oldValues=null)', async () => {
    const { ctx, audit } = make();
    await new SettingsService(ctx).update({ anomalyThreshold: 30 }, admin);
    await expect(audit.rollback(await logId(ctx, 'settings_update'), admin)).rejects.toBeInstanceOf(ServiceError);
  });

  it('неподдерживаемое действие (invoice_reconcile) → UNSUPPORTED', async () => {
    const { ctx, audit } = make();
    const inv = new InvoiceService(ctx);
    const created = await inv.createManual(
      { recognizedDate: '2026-02-01', items: [{ rawName: 'Ф', quantity: 1, unitPrice: 100, matchedNomenclatureId: 'N1' }] },
      admin,
    );
    await inv.reconcile([created.invoiceId], admin);
    await expect(audit.rollback(await logId(ctx, 'invoice_reconcile', created.invoiceId), admin)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('несуществующий лог → NOT_FOUND', async () => {
    const { ctx, audit } = make();
    await expect(audit.rollback('nope', admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
