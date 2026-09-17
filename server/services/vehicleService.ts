import type { Vehicle, VehicleExclusion, TruckPlacement } from '../../shared/index.js';
import type {
  VehicleUpsertRequest,
  TrailerUpsertRequest,
  TrailerSwapRequest,
  VehicleExclusionToggleRequest,
} from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import type { ServiceContext } from './context.js';
import { AuditService } from './auditService.js';
import { ServiceError } from './errors.js';
import type { Actor } from './invoiceService.js';

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

const TRAILER_PLACEMENTS: TruckPlacement[] = [
  'trailer_1_left',
  'trailer_1_right',
  'trailer_2_left',
  'trailer_2_right',
  'trailer_3_left',
  'trailer_3_right',
  'trailer_body',
];

/**
 * Машины/прицепы/исключения (перенос /api/vehicles*, /api/vehicle-exclusions).
 * Машины удаляются жёстко (нет deletedAt). Без пересчёта аномалий (как в legacy).
 */
export class VehicleService {
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.audit = new AuditService(ctx);
  }

  async list(): Promise<Vehicle[]> {
    return this.ctx.repositories.vehicles.getAll();
  }

  async upsert(input: VehicleUpsertRequest, actor: Actor): Promise<Vehicle> {
    if (!input.name || !input.plate) throw new ServiceError('VALIDATION', 'Имя машины и госномер обязательны');

    if (input.id) {
      const existing = await this.ctx.repositories.vehicles.getById(input.id);
      if (!existing) throw new ServiceError('NOT_FOUND', 'Машина не найдена');
      const updated: Vehicle = {
        ...existing,
        name: input.name,
        plate: input.plate,
        stsTractor: input.stsTractor || '',
        designation: input.designation || '',
        ...(input.trailerPlate !== undefined ? { trailerPlate: input.trailerPlate } : {}),
        ...(input.stsTrailer !== undefined ? { stsTrailer: input.stsTrailer } : {}),
      };
      await this.ctx.repositories.vehicles.upsert(updated);
      await this.audit.log({
        userId: actor.id,
        username: actor.username,
        action: 'vehicle_update',
        entityType: 'vehicle',
        entityId: updated.id,
        oldValues: existing,
        newValues: updated,
      });
      return updated;
    }

    const vehicle: Vehicle = {
      id: this.ctx.ids.generate('v-custom'),
      name: input.name,
      plate: input.plate,
      stsTractor: input.stsTractor || '',
      trailerPlate: input.trailerPlate || '',
      stsTrailer: input.stsTrailer || '',
      designation: input.designation || '',
    };
    await this.ctx.repositories.vehicles.upsert(vehicle);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'vehicle_create',
      entityType: 'vehicle',
      entityId: vehicle.id,
      oldValues: null,
      newValues: vehicle,
    });
    return vehicle;
  }

  async delete(id: string, actor: Actor): Promise<{ success: true }> {
    const vehicle = await this.ctx.repositories.vehicles.getById(id);
    if (!vehicle) throw new ServiceError('NOT_FOUND', 'Машина не найдена');

    const nomenclature = await this.ctx.repositories.nomenclature.getAll();
    const ops: BatchOp[] = [{ type: 'delete', collection: 'vehicles', id }];
    for (const n of nomenclature) {
      if (n.vehicleId === id) {
        ops.push({ type: 'set', collection: 'nomenclature', id: n.id, data: asDoc({ ...n, vehicleId: undefined }) });
      }
    }
    await this.ctx.gateway.commitBatch(ops);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'vehicle_delete',
      entityType: 'vehicle',
      entityId: id,
      oldValues: vehicle,
      newValues: null,
    });
    return { success: true };
  }

  async addTrailer(id: string, input: TrailerUpsertRequest, actor: Actor): Promise<Vehicle> {
    if (!input.trailerPlate) throw new ServiceError('VALIDATION', 'Госномер полуприцепа обязателен');
    const vehicle = await this.ctx.repositories.vehicles.getById(id);
    if (!vehicle) throw new ServiceError('NOT_FOUND', 'Машина не найдена');

    const oldTrailer = { trailerPlate: vehicle.trailerPlate, stsTrailer: vehicle.stsTrailer };
    const updated: Vehicle = { ...vehicle, trailerPlate: input.trailerPlate, stsTrailer: input.stsTrailer || '' };
    await this.ctx.repositories.vehicles.upsert(updated);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'vehicle_trailer_update',
      entityType: 'vehicle',
      entityId: id,
      oldValues: oldTrailer,
      newValues: { trailerPlate: input.trailerPlate, stsTrailer: input.stsTrailer },
    });
    return updated;
  }

  async deleteTrailer(id: string, actor: Actor): Promise<Vehicle> {
    const vehicle = await this.ctx.repositories.vehicles.getById(id);
    if (!vehicle) throw new ServiceError('NOT_FOUND', 'Машина не найдена');

    const oldTrailer = { trailerPlate: vehicle.trailerPlate, stsTrailer: vehicle.stsTrailer };
    const updated: Vehicle = { ...vehicle, trailerPlate: '', stsTrailer: '' };

    const nomenclature = await this.ctx.repositories.nomenclature.getAll();
    const ops: BatchOp[] = [{ type: 'set', collection: 'vehicles', id, data: asDoc(updated) }];
    for (const n of nomenclature) {
      if (n.vehicleId === id && TRAILER_PLACEMENTS.includes((n.truckPlacement || 'none') as TruckPlacement)) {
        ops.push({ type: 'set', collection: 'nomenclature', id: n.id, data: asDoc({ ...n, vehicleId: undefined }) });
      }
    }
    await this.ctx.gateway.commitBatch(ops);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'vehicle_trailer_delete',
      entityType: 'vehicle',
      entityId: id,
      oldValues: oldTrailer,
      newValues: null,
    });
    return updated;
  }

  async swapTrailers(input: TrailerSwapRequest, actor: Actor): Promise<{ success: true; message: string }> {
    if (!input.sourceVehicleId || !input.targetVehicleId) {
      throw new ServiceError('VALIDATION', 'Укажите исходный и целевой ID автомобиля для перецепки');
    }
    const now = this.ctx.clock.now();
    const nomenclature = await this.ctx.repositories.nomenclature.getAll();
    const isTrailerPart = (p: string | undefined) => TRAILER_PLACEMENTS.includes((p || 'none') as TruckPlacement);

    const sourceParts = nomenclature.filter((n) => n.vehicleId === input.sourceVehicleId && isTrailerPart(n.truckPlacement));
    const targetParts = nomenclature.filter((n) => n.vehicleId === input.targetVehicleId && isTrailerPart(n.truckPlacement));

    const ops: BatchOp[] = [];
    for (const n of sourceParts) {
      ops.push({ type: 'set', collection: 'nomenclature', id: n.id, data: asDoc({ ...n, vehicleId: input.targetVehicleId, updatedAt: now }) });
    }
    for (const n of targetParts) {
      ops.push({ type: 'set', collection: 'nomenclature', id: n.id, data: asDoc({ ...n, vehicleId: input.sourceVehicleId, updatedAt: now }) });
    }
    await this.ctx.gateway.commitBatch(ops);

    const message = `Выполнена перецепка полуприцепа между машинами ${input.sourceVehicleId} и ${input.targetVehicleId}. Перенесено деталей: ${sourceParts.length + targetParts.length}.`;
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'trailer_swap',
      entityType: 'vehicle',
      entityId: `${input.sourceVehicleId}_${input.targetVehicleId}`,
      oldValues: { sourcePartsCount: sourceParts.length, targetPartsCount: targetParts.length },
      newValues: { message },
    });
    return { success: true, message };
  }

  async listExclusions(): Promise<VehicleExclusion[]> {
    return this.ctx.repositories.vehicleExclusions.getAll();
  }

  async toggleExclusion(input: VehicleExclusionToggleRequest, actor: Actor): Promise<VehicleExclusion[]> {
    if (!input.vehicleId || !input.year || !input.month) {
      throw new ServiceError('VALIDATION', 'vehicleId, year и month обязательны');
    }
    const year = Number(input.year);
    const month = Number(input.month);
    const all = await this.ctx.repositories.vehicleExclusions.getAll();
    const existing = all.find((ex) => ex.vehicleId === input.vehicleId && ex.year === year && ex.month === month);

    if (input.excluded) {
      if (!existing) {
        const ex: VehicleExclusion = {
          id: this.ctx.ids.generate(`ex-${input.vehicleId}-${year}-${month}`),
          vehicleId: input.vehicleId,
          year,
          month,
          createdAt: this.ctx.clock.now(),
        };
        await this.ctx.repositories.vehicleExclusions.upsert(ex);
      }
    } else if (existing) {
      await this.ctx.repositories.vehicleExclusions.delete(existing.id);
    }

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'vehicle_exclusion_toggle',
      entityType: 'vehicle',
      entityId: input.vehicleId,
      oldValues: null,
      newValues: { vehicleId: input.vehicleId, year, month, excluded: input.excluded },
    });
    return this.ctx.repositories.vehicleExclusions.getAll();
  }
}
