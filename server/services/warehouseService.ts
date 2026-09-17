import type { InvoiceItem } from '../../shared/index.js';
import type { WarehouseAddRequest, WarehouseAllocateRequest } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import type { ServiceContext } from './context.js';
import { AuditService } from './auditService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/**
 * Общий склад (перенос /api/warehouse/*). Складская позиция = invoiceItem с
 * vehicleId='GENERAL' и invoiceId 'WH-*'. Без пересчёта аномалий (как в legacy).
 */
export class WarehouseService {
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.audit = new AuditService(ctx);
  }

  /** Приход ТМЦ на общий склад. */
  async add(input: WarehouseAddRequest, actor: Actor): Promise<InvoiceItem> {
    if (!input.rawName || !input.quantity || !input.unitPrice) {
      throw new ServiceError('VALIDATION', 'Заполните наименование, количество и цену за единицу');
    }
    const quantity = Number(input.quantity);
    const unitPrice = Number(input.unitPrice);
    const now = this.ctx.clock.now();

    const item: InvoiceItem = {
      id: this.ctx.ids.generate('ii-wh'),
      invoiceId: this.ctx.ids.generate('WH'),
      nomenclatureId: null,
      rawName: input.rawName,
      quantity,
      unitPrice,
      lineSum: quantity * unitPrice,
      matchedNomenclatureId: null,
      vehicleId: 'GENERAL',
      truckPlacement: 'none',
      recognizedDate: now.split('T')[0]!,
      supplierName: input.notes ? `Общий склад (${input.notes})` : 'Закупка на общий склад',
    };

    await this.ctx.repositories.invoiceItems.upsert(item);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'warehouse_item_add',
      entityType: 'invoice_item',
      entityId: item.id,
      oldValues: null,
      newValues: item,
    });
    return item;
  }

  /** Списание/аллокация ТМЦ со склада на машину (полная или частичная). */
  async allocate(input: WarehouseAllocateRequest, actor: Actor): Promise<{ success: true }> {
    const item = await this.ctx.repositories.invoiceItems.getById(input.itemId);
    if (!item) throw new ServiceError('NOT_FOUND', 'Товар на складе не найден');

    const numToAllocate = Number(input.allocateQuantity);
    if (isNaN(numToAllocate) || numToAllocate <= 0 || numToAllocate > item.quantity) {
      throw new ServiceError('VALIDATION', 'Некорректное количество для списания');
    }

    const now = this.ctx.clock.now();
    const ops: BatchOp[] = [];
    const originalQuantity = item.quantity;

    if (numToAllocate === item.quantity) {
      const updated: InvoiceItem = {
        ...item,
        vehicleId: input.targetVehicleId,
        truckPlacement: input.truckPlacement ?? item.truckPlacement,
      };
      ops.push({ type: 'set', collection: 'invoiceItems', id: item.id, data: asDoc(updated) });
    } else {
      const remaining: InvoiceItem = {
        ...item,
        quantity: item.quantity - numToAllocate,
        lineSum: (item.quantity - numToAllocate) * item.unitPrice,
      };
      const allocated: InvoiceItem = {
        ...item,
        id: this.ctx.ids.generate('ii-alloc'),
        quantity: numToAllocate,
        lineSum: numToAllocate * item.unitPrice,
        vehicleId: input.targetVehicleId,
        truckPlacement: input.truckPlacement ?? 'none',
        recognizedDate: now.split('T')[0]!,
      };
      ops.push({ type: 'set', collection: 'invoiceItems', id: item.id, data: asDoc(remaining) });
      ops.push({ type: 'set', collection: 'invoiceItems', id: allocated.id, data: asDoc(allocated) });
    }

    await this.ctx.gateway.commitBatch(ops);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'warehouse_allocate',
      entityType: 'invoice_item',
      entityId: item.id,
      oldValues: { originalQuantity },
      newValues: { targetVehicleId: input.targetVehicleId, allocatedQuantity: numToAllocate },
    });
    return { success: true };
  }
}
