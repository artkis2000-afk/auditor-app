import type { Nomenclature, NomenclatureAlias } from '../../shared/index.js';
import type { NomenclatureCreateRequest, NomenclatureUpdateRequest } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import { findBestNomenclatureMatches, type NomenclatureMatch } from '../../domain/matching/index.js';
import type { ServiceContext } from './context.js';
import { AuditService } from './auditService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

export type NomenclatureWithAliases = Nomenclature & { aliases: string[] };

export interface NomenclatureHistoryEntry {
  itemId: string;
  invoiceId: string;
  date: string;
  supplierName: string;
  vehicleName: string;
  quantity: number;
  unitPrice: number;
  lineSum: number;
}

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/**
 * Справочник номенклатуры (перенос /api/nomenclature).
 * Нормативы (normativeServiceDays) меняет только boss (legacy-правило).
 * create/update НЕ пересчитывают аномалии (как в оригинале) — см. KI-11.
 */
export class NomenclatureService {
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.audit = new AuditService(ctx);
  }

  private requireBoss(actor: Actor): void {
    if (actor.username !== 'boss') {
      throw new ServiceError('FORBIDDEN', 'Задавать/менять нормативный срок службы может только Владелец (boss)');
    }
  }

  /**
   * Список номенклатуры. ВНИМАНИЕ (KI-10): как в оригинале, выполняет запись —
   * авто-досоздаёт номенклатуру для позиций накладных, которых нет в справочнике.
   */
  async list(): Promise<NomenclatureWithAliases[]> {
    const [nomenclature, aliases, invoices, invoiceItems] = await Promise.all([
      this.ctx.repositories.nomenclature.getAll(),
      this.ctx.repositories.nomenclatureAliases.getAll(),
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.invoiceItems.getAll(),
    ]);

    const activeInvoiceIds = new Set(invoices.filter((i) => !i.deletedAt).map((i) => i.id));
    const working = [...nomenclature];
    const ops: BatchOp[] = [];
    const now = this.ctx.clock.now();

    for (const ii of invoiceItems) {
      if (!activeInvoiceIds.has(ii.invoiceId)) continue;
      const rawName = (ii.rawName || '').trim();
      if (!rawName) continue;
      const exists = working.some(
        (n) =>
          !n.deletedAt &&
          (n.normalizedName.toLowerCase() === rawName.toLowerCase() ||
            n.id === ii.nomenclatureId ||
            n.id === ii.matchedNomenclatureId),
      );
      if (exists) continue;

      const inv = invoices.find((i) => i.id === ii.invoiceId);
      const supplierStr = inv?.supplierName || inv?.rawSupplierName || 'Накладная';
      const invDate = inv?.recognizedDate || 'Н/Д';
      const newNom: Nomenclature = {
        id: this.ctx.ids.generate('nom-auto'),
        normalizedName: rawName,
        category: 'Запчасти из накладных',
        normativeServiceDays: 180,
        normativeLifespanText: '6 месяцев',
        notes: `Выгружено из накладной (${supplierStr}, ${invDate})`,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      working.push(newNom);
      ops.push({ type: 'set', collection: 'nomenclature', id: newNom.id, data: asDoc(newNom) });
      ops.push({
        type: 'set',
        collection: 'invoiceItems',
        id: ii.id,
        data: asDoc({ ...ii, nomenclatureId: newNom.id, matchedNomenclatureId: newNom.id }),
      });
    }

    if (ops.length > 0) await this.ctx.gateway.commitBatch(ops);

    return working
      .filter((n) => !n.deletedAt)
      .map((n) => ({
        ...n,
        vehicleId: n.vehicleId || 'v-volvo',
        aliases: aliases.filter((a) => a.nomenclatureId === n.id).map((a) => a.aliasName),
      }));
  }

  /** История закупок детали (read-only). */
  async history(nomenclatureId: string): Promise<NomenclatureHistoryEntry[]> {
    const [items, invoices, suppliers, vehicles] = await Promise.all([
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.suppliers.getAll(),
      this.ctx.repositories.vehicles.getAll(),
    ]);

    const history = items
      .filter((it) => it.matchedNomenclatureId === nomenclatureId)
      .map((it) => {
        const inv = invoices.find((i) => i.id === it.invoiceId && !i.deletedAt);
        if (!inv) return null;
        const supplier = suppliers.find((s) => s.id === inv.supplierId);
        const vehicle = it.vehicleId ? vehicles.find((v) => v.id === it.vehicleId) : null;
        return {
          itemId: it.id,
          invoiceId: inv.id,
          date: inv.recognizedDate,
          supplierName: supplier ? supplier.name : 'Не распознан',
          vehicleName: vehicle ? `${vehicle.name} [${vehicle.plate}]` : 'Не указана',
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineSum: it.lineSum,
        };
      })
      .filter((h): h is NomenclatureHistoryEntry => h !== null);

    history.sort((a, b) => b.date.localeCompare(a.date));
    return history;
  }

  async create(input: NomenclatureCreateRequest, actor: Actor): Promise<NomenclatureWithAliases> {
    if (input.normativeServiceDays !== undefined && Number(input.normativeServiceDays) !== 0) {
      this.requireBoss(actor);
    }
    if (!input.normalizedName) throw new ServiceError('VALIDATION', 'Название обязательно');

    const all = await this.ctx.repositories.nomenclature.getAll();
    if (all.some((n) => !n.deletedAt && n.normalizedName.toLowerCase() === input.normalizedName!.toLowerCase())) {
      throw new ServiceError('CONFLICT', 'Деталь с таким названием уже существует в справочнике');
    }

    const now = this.ctx.clock.now();
    const id = this.ctx.ids.generate('n');
    const nomen: Nomenclature = {
      id,
      normalizedName: input.normalizedName,
      category: input.category || 'Расходные материалы',
      normativeServiceDays: Number(input.normativeServiceDays) || 0,
      notes: input.notes || '',
      truckPlacement: input.truckPlacement || 'none',
      vehicleId: input.vehicleId || 'v-volvo',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const aliasList = (input.aliases || []).filter(Boolean).map((a) => a.trim());
    const ops: BatchOp[] = [{ type: 'set', collection: 'nomenclature', id, data: asDoc(nomen) }];
    for (const alias of aliasList) {
      const aliasDoc: NomenclatureAlias = { id: this.ctx.ids.generate('na'), nomenclatureId: id, aliasName: alias };
      ops.push({ type: 'set', collection: 'nomenclatureAliases', id: aliasDoc.id, data: asDoc(aliasDoc) });
    }
    await this.ctx.gateway.commitBatch(ops);

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'nomenclature_create',
      entityType: 'nomenclature',
      entityId: id,
      oldValues: null,
      newValues: { ...nomen, aliases: aliasList },
    });
    return { ...nomen, aliases: aliasList };
  }

  async update(id: string, input: NomenclatureUpdateRequest, actor: Actor): Promise<NomenclatureWithAliases> {
    const nomen = await this.ctx.repositories.nomenclature.getById(id);
    if (!nomen || nomen.deletedAt) throw new ServiceError('NOT_FOUND', 'Деталь не найдена');

    if (input.normativeServiceDays !== undefined && Number(input.normativeServiceDays) !== nomen.normativeServiceDays) {
      this.requireBoss(actor);
    }

    const currentAliases = (await this.ctx.repositories.nomenclatureAliases.listByNomenclature(id)).map((a) => a.aliasName);
    const oldValues = { ...nomen, aliases: currentAliases };

    const updated: Nomenclature = {
      ...nomen,
      normalizedName: input.normalizedName ?? nomen.normalizedName,
      category: input.category !== undefined ? input.category || 'Расходные материалы' : nomen.category,
      normativeServiceDays:
        input.normativeServiceDays !== undefined ? Number(input.normativeServiceDays) || 0 : nomen.normativeServiceDays,
      normativeLifespanText:
        input.normativeLifespanText !== undefined ? String(input.normativeLifespanText) : nomen.normativeLifespanText,
      notes: input.notes !== undefined ? input.notes || '' : nomen.notes,
      truckPlacement: input.truckPlacement !== undefined ? input.truckPlacement || 'none' : nomen.truckPlacement,
      vehicleId: input.vehicleId !== undefined ? input.vehicleId || 'v-volvo' : nomen.vehicleId,
      updatedAt: this.ctx.clock.now(),
    };

    // Legacy: старые алиасы всегда удаляются, новые пересоздаются из переданных (если есть).
    const ops: BatchOp[] = [{ type: 'set', collection: 'nomenclature', id, data: asDoc(updated) }];
    const existingAliasDocs = await this.ctx.repositories.nomenclatureAliases.listByNomenclature(id);
    for (const a of existingAliasDocs) ops.push({ type: 'delete', collection: 'nomenclatureAliases', id: a.id });
    const aliasList = Array.isArray(input.aliases) ? input.aliases.filter(Boolean).map((a) => a.trim()) : [];
    for (const alias of aliasList) {
      const aliasDoc: NomenclatureAlias = { id: this.ctx.ids.generate('na'), nomenclatureId: id, aliasName: alias };
      ops.push({ type: 'set', collection: 'nomenclatureAliases', id: aliasDoc.id, data: asDoc(aliasDoc) });
    }
    await this.ctx.gateway.commitBatch(ops);

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'nomenclature_edit',
      entityType: 'nomenclature',
      entityId: id,
      oldValues,
      newValues: { ...updated, aliases: aliasList },
    });
    return { ...updated, aliases: aliasList };
  }

  async softDelete(id: string, actor: Actor): Promise<{ success: true }> {
    const nomen = await this.ctx.repositories.nomenclature.getById(id);
    if (!nomen || nomen.deletedAt) throw new ServiceError('NOT_FOUND', 'Деталь не найдена');
    const now = this.ctx.clock.now();
    await this.ctx.repositories.nomenclature.upsert({ ...nomen, deletedAt: now, updatedAt: now });
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'nomenclature_delete',
      entityType: 'nomenclature',
      entityId: id,
      oldValues: { deletedAt: null },
      newValues: { deletedAt: now },
    });
    return { success: true };
  }

  async match(q: string): Promise<NomenclatureMatch[]> {
    if (!q) return [];
    const [nomenclature, aliases] = await Promise.all([
      this.ctx.repositories.nomenclature.getAll(),
      this.ctx.repositories.nomenclatureAliases.getAll(),
    ]);
    return findBestNomenclatureMatches(q, nomenclature, aliases);
  }
}
