import type { AuditLog, NomenclatureAlias } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

export interface AuditLogInput {
  userId: string;
  username: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * Журнал аудита. Перенос поведения dbService.logAction (запись) и /api/audit-logs (чтение).
 * rollback реализуется отдельной подфазой вместе с InvoiceService/entity-сервисами
 * (он восстанавливает состояние этих сущностей).
 */
export class AuditService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Записать действие в журнал (изменяющая операция: append документа). */
  async log(input: AuditLogInput): Promise<AuditLog> {
    const entry: AuditLog = {
      id: this.ctx.ids.generate('al'),
      userId: input.userId,
      username: input.username,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: input.oldValues ?? null,
      newValues: input.newValues ?? null,
      timestamp: this.ctx.clock.now(),
    };
    await this.ctx.repositories.auditLogs.upsert(entry);
    return entry;
  }

  /** Последние N записей (по убыванию времени). Как в оригинале — по умолчанию 200. */
  async list(limit = 200): Promise<AuditLog[]> {
    const all = await this.ctx.repositories.auditLogs.getAll();
    return [...all]
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, limit);
  }

  /**
   * Откат действия по записи аудита (полный перенос rollback-свитча server.ts).
   * Восстанавливает invoices/invoiceItems/anomalyFlags/suppliers/nomenclature/aliases/settings.
   * Для invoice-кейсов выполняется пересчёт аномалий; для supplier/nomenclature/settings — нет (legacy, KI-9).
   * Неподдерживаемые действия (invoice_reconcile, vehicle_*, warehouse_* и т.п.) → ошибка.
   */
  async rollback(logId: string, actor: Actor): Promise<{ success: true; message: string }> {
    const repos = this.ctx.repositories;
    const log = await repos.auditLogs.getById(logId);
    if (!log) throw new ServiceError('NOT_FOUND', 'Запись аудита не найдена');

    const old = log.oldValues as Record<string, unknown> | null;
    const entityId = log.entityId;
    const now = this.ctx.clock.now();
    const ops: BatchOp[] = [];
    let recalcNeeded = false;
    let message = '';

    switch (log.action) {
      case 'invoice_manual_create':
      case 'invoice_ocr': {
        ops.push({ type: 'delete', collection: 'invoices', id: entityId });
        for (const it of await repos.invoiceItems.listByInvoice(entityId)) {
          ops.push({ type: 'delete', collection: 'invoiceItems', id: it.id });
        }
        for (const f of await repos.anomalyFlags.getAll()) {
          if (f.invoiceId === entityId || f.relatedInvoiceId === entityId) {
            ops.push({ type: 'delete', collection: 'anomalyFlags', id: f.id });
          }
        }
        recalcNeeded = true;
        message = `Создание накладной ${entityId} успешно отменено.`;
        break;
      }
      case 'invoice_delete': {
        const invoice = await repos.invoices.getById(entityId);
        if (!invoice) throw new ServiceError('NOT_FOUND', 'Накладная не найдена для восстановления');
        ops.push({ type: 'set', collection: 'invoices', id: entityId, data: asDoc({ ...invoice, deletedAt: null }) });
        await this.restoreItems(entityId, old, ops);
        recalcNeeded = true;
        message = `Удаление накладной ${entityId} отменено. Накладная и позиции восстановлены.`;
        break;
      }
      case 'invoice_edit': {
        const invoice = await repos.invoices.getById(entityId);
        if (!invoice || !old) throw new ServiceError('NOT_FOUND', 'Накладная не найдена для отката');
        ops.push({
          type: 'set',
          collection: 'invoices',
          id: entityId,
          data: asDoc({
            ...invoice,
            recognizedDate: old.recognizedDate,
            supplierName: old.supplierName,
            supplierId: old.supplierId,
            comment: old.comment,
            totalSum: old.totalSum,
            status: old.status,
            updatedAt: now,
          }),
        });
        await this.restoreItems(entityId, old, ops);
        recalcNeeded = true;
        message = `Редактирование накладной ${entityId} отменено.`;
        break;
      }
      case 'invoice_confirm': {
        const invoice = await repos.invoices.getById(entityId);
        if (!invoice || !old) throw new ServiceError('NOT_FOUND', 'Накладная не найдена');
        ops.push({ type: 'set', collection: 'invoices', id: entityId, data: asDoc({ ...invoice, status: old.status, updatedAt: now }) });
        recalcNeeded = true;
        message = `Подтверждение накладной ${entityId} отменено.`;
        break;
      }
      case 'invoice_approve_flag': {
        const flagType = old?.flagType;
        if (!flagType) throw new ServiceError('VALIDATION', 'Информация об одобренном флаге отсутствует');
        for (const f of await repos.anomalyFlags.getAll()) {
          if (f.invoiceId === entityId && f.flagType === flagType) {
            ops.push({ type: 'set', collection: 'anomalyFlags', id: f.id, data: asDoc({ ...f, isResolved: false, resolvedBy: null, resolvedAt: null }) });
          }
        }
        recalcNeeded = true;
        message = `Одобрение аномалии "${String(flagType)}" для накладной ${entityId} отменено.`;
        break;
      }
      case 'invoice_approve_all_flags': {
        for (const f of await repos.anomalyFlags.getAll()) {
          if (f.invoiceId === entityId || f.relatedInvoiceId === entityId) {
            ops.push({ type: 'set', collection: 'anomalyFlags', id: f.id, data: asDoc({ ...f, isResolved: false, resolvedBy: null, resolvedAt: null }) });
          }
        }
        recalcNeeded = true;
        message = `Одобрение всех флагов накладной ${entityId} отменено.`;
        break;
      }
      case 'supplier_create': {
        ops.push({ type: 'delete', collection: 'suppliers', id: entityId });
        message = `Создание поставщика ${entityId} отменено.`;
        break;
      }
      case 'supplier_edit': {
        const supplier = await repos.suppliers.getById(entityId);
        if (!supplier || !old) throw new ServiceError('NOT_FOUND', 'Поставщик не найден');
        ops.push({ type: 'set', collection: 'suppliers', id: entityId, data: asDoc({ ...old, updatedAt: now }) });
        message = `Изменения поставщика ${entityId} отменены.`;
        break;
      }
      case 'supplier_delete': {
        const supplier = await repos.suppliers.getById(entityId);
        if (!supplier) throw new ServiceError('NOT_FOUND', 'Поставщик не найден');
        ops.push({ type: 'set', collection: 'suppliers', id: entityId, data: asDoc({ ...supplier, deletedAt: null, updatedAt: now }) });
        message = `Удаление поставщика ${entityId} отменено.`;
        break;
      }
      case 'nomenclature_create': {
        ops.push({ type: 'delete', collection: 'nomenclature', id: entityId });
        for (const a of await repos.nomenclatureAliases.listByNomenclature(entityId)) {
          ops.push({ type: 'delete', collection: 'nomenclatureAliases', id: a.id });
        }
        message = `Создание детали ${entityId} отменено.`;
        break;
      }
      case 'nomenclature_edit': {
        const nomen = await repos.nomenclature.getById(entityId);
        if (!nomen || !old) throw new ServiceError('NOT_FOUND', 'Деталь не найдена для отката');
        ops.push({
          type: 'set',
          collection: 'nomenclature',
          id: entityId,
          data: asDoc({
            ...nomen,
            normalizedName: old.normalizedName,
            category: old.category,
            normativeServiceDays: old.normativeServiceDays,
            normativeLifespanText: old.normativeLifespanText,
            notes: old.notes,
            truckPlacement: old.truckPlacement,
            vehicleId: old.vehicleId,
            updatedAt: now,
          }),
        });
        for (const a of await repos.nomenclatureAliases.listByNomenclature(entityId)) {
          ops.push({ type: 'delete', collection: 'nomenclatureAliases', id: a.id });
        }
        if (Array.isArray(old.aliases)) {
          for (const alias of old.aliases as string[]) {
            const doc: NomenclatureAlias = { id: this.ctx.ids.generate('na'), nomenclatureId: entityId, aliasName: alias };
            ops.push({ type: 'set', collection: 'nomenclatureAliases', id: doc.id, data: asDoc(doc) });
          }
        }
        message = `Изменения детали ${entityId} отменены.`;
        break;
      }
      case 'nomenclature_delete': {
        const nomen = await repos.nomenclature.getById(entityId);
        if (!nomen) throw new ServiceError('NOT_FOUND', 'Деталь не найдена');
        ops.push({ type: 'set', collection: 'nomenclature', id: entityId, data: asDoc({ ...nomen, deletedAt: null, updatedAt: now }) });
        message = `Удаление детали ${entityId} отменено.`;
        break;
      }
      case 'settings_update': {
        if (!old) throw new ServiceError('VALIDATION', 'Предыдущие настройки отсутствуют');
        ops.push({ type: 'set', collection: 'settings', id: 'global', data: asDoc(old) });
        message = `Изменения настроек отменены.`;
        break;
      }
      default:
        throw new ServiceError('UNSUPPORTED', `Операция "${log.action}" не поддерживает откат`);
    }

    if (ops.length > 0) await this.ctx.gateway.commitBatch(ops);
    if (recalcNeeded) await new AnomalyService(this.ctx).recalculateAll();

    await this.log({
      userId: actor.id,
      username: actor.username,
      action: 'audit_rollback',
      entityType: 'audit_log',
      entityId: logId,
      oldValues: { action: log.action, entityId },
      newValues: { success: true, message },
    });

    return { success: true, message };
  }

  /** Восстанавливает позиции накладной из snapshot old.items (удаляя текущие, которых нет в snapshot). */
  private async restoreItems(invoiceId: string, old: Record<string, unknown> | null, ops: BatchOp[]): Promise<void> {
    if (!old || !Array.isArray(old.items)) return;
    const restored = old.items as Array<{ id: string }>;
    const restoredIds = new Set(restored.map((it) => it.id));
    for (const cur of await this.ctx.repositories.invoiceItems.listByInvoice(invoiceId)) {
      if (!restoredIds.has(cur.id)) ops.push({ type: 'delete', collection: 'invoiceItems', id: cur.id });
    }
    for (const it of restored) {
      ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    }
  }
}
