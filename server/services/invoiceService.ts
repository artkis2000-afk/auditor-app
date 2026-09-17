import type { AnomalyFlag, Invoice, InvoiceItem } from '../../shared/index.js';
import type { ManualInvoiceRequest, InvoiceUpdateRequest } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { AuditService } from './auditService.js';
import { RECONCILED_PIN, buildInvoiceItems, ensureSupplier } from './invoiceHelpers.js';

/** Действующий пользователь (для аудита и правил доступа). Роль-доступ — на слое routes. */
export interface Actor {
  id: string;
  username: string;
  role?: string;
}

export type InvoiceErrorCode = 'NOT_FOUND' | 'PIN_REQUIRED';

export class InvoiceServiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceServiceError';
  }
}

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/**
 * Бизнес-операции над накладными. Перенос обработчиков server.ts.
 * Пересчёт аномалий — через AnomalyService.recalculateAll (полная совместимость с оригиналом).
 * Запись — атомарным commitBatch; в одном батче каждый документ затрагивается не более одного раза.
 */
export class InvoiceService {
  private readonly anomaly: AnomalyService;
  private readonly audit: AuditService;

  constructor(private readonly ctx: ServiceContext) {
    this.anomaly = new AnomalyService(ctx);
    this.audit = new AuditService(ctx);
  }

  /** Ручное создание накладной. */
  async createManual(input: ManualInvoiceRequest, actor: Actor): Promise<{ invoiceId: string; status: string }> {
    const now = this.ctx.clock.now();
    const invoiceId = this.ctx.ids.generate('inv');

    const suppliers = await this.ctx.repositories.suppliers.getAll();
    const { supplierId, created } = ensureSupplier(suppliers, input.supplierName, actor.id, this.ctx.ids, now);
    const { items, totalSum } = buildInvoiceItems(input.items, invoiceId, this.ctx.ids);

    const invoice: Invoice = {
      id: invoiceId,
      imagePath: '',
      recognizedDate: input.recognizedDate || now.split('T')[0]!,
      status: 'confirmed', // предварительный; финальный статус задаст recalculateAll
      uploadedBy: actor.id,
      supplierId,
      supplierName: input.supplierName || 'Не указан',
      rawSupplierName: null,
      totalSum,
      filename: 'Создана вручную',
      comment: input.comment || '',
      isReconciled: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const ops: BatchOp[] = [];
    if (created) ops.push({ type: 'set', collection: 'suppliers', id: created.id, data: asDoc(created) });
    ops.push({ type: 'set', collection: 'invoices', id: invoiceId, data: asDoc(invoice) });
    for (const it of items) ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    const finalStatus = (await this.ctx.repositories.invoices.getById(invoiceId))?.status ?? 'confirmed';
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_manual_create',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: null,
      newValues: { status: finalStatus, itemsCount: items.length },
    });

    return { invoiceId, status: finalStatus };
  }

  /** Редактирование накладной. */
  async edit(
    id: string,
    input: InvoiceUpdateRequest,
    actor: Actor,
  ): Promise<{ totalSum: number; status: string; flagsCount: number; flags: AnomalyFlag[] }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');
    if (invoice.isReconciled && String(input.pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'Накладная сверена и заблокирована. Требуется PIN-код.');
    }

    const oldItems = await this.ctx.repositories.invoiceItems.listByInvoice(id);
    const suppliers = await this.ctx.repositories.suppliers.getAll();
    const now = this.ctx.clock.now();
    const { supplierId, created } = ensureSupplier(suppliers, input.supplierName, actor.id, this.ctx.ids, now);
    const { items, totalSum } = buildInvoiceItems(input.items, id, this.ctx.ids);

    const updated: Invoice = {
      ...invoice,
      recognizedDate: input.recognizedDate,
      supplierName: input.supplierName,
      supplierId,
      comment: input.comment !== undefined ? input.comment : invoice.comment,
      totalSum,
      updatedAt: now,
    };

    const newIds = new Set(items.map((i) => i.id));
    const ops: BatchOp[] = [];
    if (created) ops.push({ type: 'set', collection: 'suppliers', id: created.id, data: asDoc(created) });
    for (const oi of oldItems) if (!newIds.has(oi.id)) ops.push({ type: 'delete', collection: 'invoiceItems', id: oi.id });
    for (const it of items) ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    ops.push({ type: 'set', collection: 'invoices', id, data: asDoc(updated) });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    const finalInvoice = await this.ctx.repositories.invoices.getById(id);
    const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
    const status = finalInvoice?.status ?? invoice.status;

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_edit',
      entityType: 'invoice',
      entityId: id,
      oldValues: { ...invoice, items: oldItems },
      newValues: {
        recognizedDate: input.recognizedDate,
        supplierName: input.supplierName,
        totalSum,
        itemsCount: items.length,
        status,
        flagsCount: flags.length,
      },
    });

    return { totalSum, status, flagsCount: flags.length, flags };
  }

  /** Подтверждение накладной. */
  async confirm(id: string, actor: Actor): Promise<{ status: string; flagsCount: number; flags: AnomalyFlag[] }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');

    const oldStatus = invoice.status;
    const now = this.ctx.clock.now();
    await this.ctx.gateway.commitBatch([
      { type: 'set', collection: 'invoices', id, data: asDoc({ ...invoice, status: 'confirmed', updatedAt: now }) },
    ]);

    await this.anomaly.recalculateAll();

    const finalInvoice = await this.ctx.repositories.invoices.getById(id);
    const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
    const status = finalInvoice?.status ?? 'confirmed';

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_confirm',
      entityType: 'invoice',
      entityId: id,
      oldValues: { status: oldStatus },
      newValues: { status, flagsCount: flags.length },
    });

    return { status, flagsCount: flags.length, flags };
  }

  /** Мягкое удаление накладной (позиции удаляются жёстко — legacy, KI-8). */
  async delete(id: string, actor: Actor, pin?: string): Promise<{ success: true }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');
    if (invoice.isReconciled && String(pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'Накладная сверена и заблокирована. Требуется PIN-код.');
    }

    const oldItems = await this.ctx.repositories.invoiceItems.listByInvoice(id);
    const now = this.ctx.clock.now();

    const ops: BatchOp[] = [{ type: 'set', collection: 'invoices', id, data: asDoc({ ...invoice, deletedAt: now }) }];
    for (const oi of oldItems) ops.push({ type: 'delete', collection: 'invoiceItems', id: oi.id });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_delete',
      entityType: 'invoice',
      entityId: id,
      oldValues: { deletedAt: null, items: oldItems },
      newValues: { deletedAt: now },
    });

    return { success: true };
  }

  /**
   * Массовое мягкое удаление.
   * ОТЛИЧИЕ ОТ LEGACY (KI-4): проверяется isReconciled + PIN, как в одиночном delete.
   * Если в пакете есть сверенная накладная и PIN неверный — операция отклоняется целиком.
   */
  async bulkDelete(ids: string[], actor: Actor, pin?: string): Promise<{ deletedCount: number }> {
    const now = this.ctx.clock.now();
    const targets: { invoice: Invoice; items: InvoiceItem[] }[] = [];

    for (const id of ids) {
      const invoice = await this.ctx.repositories.invoices.getById(id);
      if (!invoice || invoice.deletedAt) continue;
      const items = await this.ctx.repositories.invoiceItems.listByInvoice(id);
      targets.push({ invoice, items });
    }

    // KI-4: блокируем всю операцию, если есть сверенная накладная без верного PIN
    if (targets.some((t) => t.invoice.isReconciled) && String(pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'В пакете есть сверенные накладные. Требуется PIN-код.');
    }

    const ops: BatchOp[] = [];
    for (const { invoice, items } of targets) {
      ops.push({ type: 'set', collection: 'invoices', id: invoice.id, data: asDoc({ ...invoice, deletedAt: now }) });
      for (const it of items) ops.push({ type: 'delete', collection: 'invoiceItems', id: it.id });
    }

    if (ops.length > 0) {
      await this.ctx.gateway.commitBatch(ops);
      await this.anomaly.recalculateAll();
      for (const { invoice, items } of targets) {
        await this.audit.log({
          userId: actor.id,
          username: actor.username,
          action: 'invoice_delete',
          entityType: 'invoice',
          entityId: invoice.id,
          oldValues: { deletedAt: null, items },
          newValues: { deletedAt: now },
        });
      }
    }

    return { deletedCount: targets.length };
  }

  /** Массовая сверка (СВЕРЕНО): блокирует накладную, помечает её флаги resolved. */
  async reconcile(ids: string[], actor: Actor): Promise<{ reconciledCount: number }> {
    const now = this.ctx.clock.now();
    const resolvedBy = actor.username || 'Сверено';
    const reconciled: Invoice[] = [];
    const ops: BatchOp[] = [];

    for (const id of ids) {
      const invoice = await this.ctx.repositories.invoices.getById(id);
      if (!invoice || invoice.deletedAt) continue;

      reconciled.push(invoice);
      ops.push({
        type: 'set',
        collection: 'invoices',
        id,
        data: asDoc({ ...invoice, isReconciled: true, status: 'confirmed', updatedAt: now }),
      });

      // Пометить существующие флаги resolved с resolvedBy=username (перенос legacy);
      // recalculateAll сохранит resolvedBy через resolvedMap.
      const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
      for (const f of flags) {
        ops.push({
          type: 'set',
          collection: 'anomalyFlags',
          id: f.id,
          data: asDoc({ ...f, isResolved: true, resolvedBy, resolvedAt: now }),
        });
      }
    }

    if (ops.length > 0) {
      await this.ctx.gateway.commitBatch(ops);
      await this.anomaly.recalculateAll();
      for (const invoice of reconciled) {
        await this.audit.log({
          userId: actor.id,
          username: actor.username,
          action: 'invoice_reconcile',
          entityType: 'invoice',
          entityId: invoice.id,
          oldValues: { isReconciled: false },
          newValues: { isReconciled: true, status: 'confirmed' },
        });
      }
    }

    return { reconciledCount: reconciled.length };
  }
}
