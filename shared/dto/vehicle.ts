import { z } from 'zod';

export const vehicleUpsertRequestSchema = z.object({
  id: z.string().optional(), // если задан — редактирование, иначе создание
  name: z.string().min(1),
  plate: z.string().min(1),
  stsTractor: z.string().optional(),
  trailerPlate: z.string().optional(),
  stsTrailer: z.string().optional(),
  designation: z.string().optional(),
});
export type VehicleUpsertRequest = z.infer<typeof vehicleUpsertRequestSchema>;

export const trailerUpsertRequestSchema = z.object({
  trailerPlate: z.string().min(1),
  stsTrailer: z.string().optional(),
});
export type TrailerUpsertRequest = z.infer<typeof trailerUpsertRequestSchema>;

export const vehicleExclusionToggleRequestSchema = z.object({
  vehicleId: z.string().min(1),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  excluded: z.boolean(),
});
export type VehicleExclusionToggleRequest = z.infer<typeof vehicleExclusionToggleRequestSchema>;

export const trailerSwapRequestSchema = z.object({
  sourceVehicleId: z.string().min(1),
  targetVehicleId: z.string().min(1),
});
export type TrailerSwapRequest = z.infer<typeof trailerSwapRequestSchema>;
