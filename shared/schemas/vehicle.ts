import { z } from 'zod';

export const vehicleSchema = z.object({
  id: z.string(),
  name: z.string(),
  plate: z.string(),
  trailerPlate: z.string().optional(),
  stsTractor: z.string().optional(),
  stsTrailer: z.string().optional(),
  designation: z.string().optional(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const vehicleExclusionSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  createdAt: z.string(),
});
export type VehicleExclusion = z.infer<typeof vehicleExclusionSchema>;
