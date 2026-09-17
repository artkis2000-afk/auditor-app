import type { AuditLog } from '../../shared/index.js';
import type { ServiceContext } from './context.js';

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
}
