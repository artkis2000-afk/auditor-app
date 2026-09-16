import { z } from 'zod';
import { truckPlacementSchema } from '../enums/index.js';

// Приход ТМЦ на общий склад
export const warehouseAddRequestSchema = z.object({
  rawName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  notes: z.string().optional(),
});
export type WarehouseAddRequest = z.infer<typeof warehouseAddRequestSchema>;

// Списание/аллокация со склада на конкретную машину
export const warehouseAllocateRequestSchema = z.object({
  itemId: z.string().min(1),
  targetVehicleId: z.string().min(1),
  allocateQuantity: z.coerce.number().positive(),
  truckPlacement: truckPlacementSchema.optional(),
});
export type WarehouseAllocateRequest = z.infer<typeof warehouseAllocateRequestSchema>;

// Изменение привязки позиции к машине/узлу
export const placementUpdateRequestSchema = z.object({
  vehicleId: z.string().nullable().optional(),
  truckPlacement: truckPlacementSchema.nullable().optional(),
});
export type PlacementUpdateRequest = z.infer<typeof placementUpdateRequestSchema>;
