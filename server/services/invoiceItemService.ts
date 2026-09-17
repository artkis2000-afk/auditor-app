import type { InvoiceItem } from '../../shared/index.js';
import type { PlacementUpdateRequest } from '../../shared/index.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { AuditService } from './auditService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

/**
 * Позиции накладных / склада (перенос /api/invoice-items*).
 * getAll подставляет денорм recognizedDate/supplierName из накладной (как в legacy).
 * updatePlacement меняет привязку и пересчитывает аномалии (placement влияет на детект дубликатов).
 */
export class InvoiceItemService {
  private readonly anomaly: AnomalyService;
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.anomaly = new AnomalyService(ctx);
    this.audit = new AuditService(ctx);
  }

  /** Все активные позиции (из неудалённых накладных или склада WH-*) с денорм-полями. */
  async getAll(): Promise<InvoiceItem[]> {
    const [items, invoices] = await Promise.all([
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.invoices.getAll(),
    ]);
    const activeMap = new Map(invoices.filter((i) => !i.deletedAt).map((i) => [i.id, i]));
    const today = this.ctx.clock.now().split('T')[0]!;

    return items
      .filter((item) => !item.invoiceId || activeMap.has(item.invoiceId) || item.invoiceId.startsWith('WH-'))
      .map((item) => {
        const inv = activeMap.get(item.invoiceId);
        return {
          ...item,
          recognizedDate: item.recognizedDate || inv?.recognizedDate || inv?.createdAt?.split('T')[0] || today,
          supplierName: item.supplierName || inv?.supplierName || inv?.rawSupplierName || 'Общий склад',
        };
      });
  }

  /** Смена машины/узла у позиции + пересчёт аномалий + аудит (перенос PUT /invoice-items/:id/placement). */
  async updatePlacement(
    itemId: string,
    input: PlacementUpdateRequest,
    actor: Actor,
  ): Promise<{ success: true; item: InvoiceItem }> {
    const item = await this.ctx.repositories.invoiceItems.getById(itemId);
    if (!item) throw new ServiceError('NOT_FOUND', 'Позиция накладной не найдена');

    const oldValues = { vehicleId: item.vehicleId, truckPlacement: item.truckPlacement };
    const updated: InvoiceItem = {
      ...item,
      vehicleId: input.vehicleId ?? null,
      truckPlacement: input.truckPlacement ?? null,
    };
    await this.ctx.repositories.invoiceItems.upsert(updated);
    await this.anomaly.recalculateAll();

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'item_placement_update',
      entityType: 'invoice_item',
      entityId: item.id,
      oldValues,
      newValues: { vehicleId: updated.vehicleId, truckPlacement: updated.truckPlacement, rawName: item.rawName },
    });
    return { success: true, item: updated };
  }
}
