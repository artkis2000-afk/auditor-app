import type { Supplier } from '../../shared/index.js';
import type { SupplierCreateRequest, SupplierUpdateRequest } from '../../shared/index.js';
import { findBestSupplierMatches, type SupplierMatch } from '../../domain/matching/index.js';
import type { ServiceContext } from './context.js';
import { AuditService } from './auditService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

/** CRUD поставщиков (перенос обработчиков /api/suppliers). Без пересчёта аномалий (как в legacy). */
export class SupplierService {
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.audit = new AuditService(ctx);
  }

  /** Активные поставщики. */
  async list(): Promise<Supplier[]> {
    return this.ctx.repositories.suppliers.listActive();
  }

  async create(input: SupplierCreateRequest, actor: Actor): Promise<Supplier> {
    if (!input.name || !input.inn) throw new ServiceError('VALIDATION', 'Имя и ИНН обязательны');

    const active = await this.ctx.repositories.suppliers.listActive();
    if (active.some((s) => s.inn === input.inn)) {
      throw new ServiceError('CONFLICT', 'Поставщик с таким ИНН уже существует');
    }

    const now = this.ctx.clock.now();
    const supplier: Supplier = {
      id: this.ctx.ids.generate('s'),
      name: input.name,
      legalAddress: input.legalAddress || '',
      inn: input.inn,
      isApproved: input.isApproved !== undefined ? input.isApproved : true,
      notes: input.notes || '',
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.ctx.repositories.suppliers.upsert(supplier);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'supplier_create',
      entityType: 'supplier',
      entityId: supplier.id,
      oldValues: null,
      newValues: supplier,
    });
    return supplier;
  }

  async update(id: string, input: SupplierUpdateRequest, actor: Actor): Promise<Supplier> {
    const supplier = await this.ctx.repositories.suppliers.getById(id);
    if (!supplier || supplier.deletedAt) throw new ServiceError('NOT_FOUND', 'Поставщик не найден');

    const oldValues = { ...supplier };
    const updated: Supplier = {
      ...supplier,
      name: input.name ?? supplier.name,
      legalAddress: input.legalAddress || '',
      inn: input.inn ?? supplier.inn,
      isApproved: input.isApproved as boolean,
      notes: input.notes || '',
      updatedAt: this.ctx.clock.now(),
    };
    await this.ctx.repositories.suppliers.upsert(updated);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'supplier_edit',
      entityType: 'supplier',
      entityId: id,
      oldValues,
      newValues: updated,
    });
    return updated;
  }

  async softDelete(id: string, actor: Actor): Promise<{ success: true }> {
    const supplier = await this.ctx.repositories.suppliers.getById(id);
    if (!supplier || supplier.deletedAt) throw new ServiceError('NOT_FOUND', 'Поставщик не найден');

    const now = this.ctx.clock.now();
    await this.ctx.repositories.suppliers.upsert({ ...supplier, deletedAt: now });
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'supplier_delete',
      entityType: 'supplier',
      entityId: id,
      oldValues: { deletedAt: null },
      newValues: { deletedAt: now },
    });
    return { success: true };
  }

  /** Подбор поставщиков по строке (read-only). */
  async match(q: string): Promise<SupplierMatch[]> {
    if (!q) return [];
    const suppliers = await this.ctx.repositories.suppliers.getAll();
    return findBestSupplierMatches(q, suppliers);
  }
}
