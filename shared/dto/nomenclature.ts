import { z } from 'zod';
import { truckPlacementSchema } from '../enums/index.js';

export const nomenclatureCreateRequestSchema = z.object({
  normalizedName: z.string().min(1),
  category: z.string().optional(),
  normativeServiceDays: z.coerce.number().optional(),
  normativeLifespanText: z.string().optional(),
  notes: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  truckPlacement: truckPlacementSchema.optional(),
  vehicleId: z.string().optional(),
});
export type NomenclatureCreateRequest = z.infer<typeof nomenclatureCreateRequestSchema>;

export const nomenclatureUpdateRequestSchema = nomenclatureCreateRequestSchema.partial().extend({
  normalizedName: z.string().min(1).optional(),
});
export type NomenclatureUpdateRequest = z.infer<typeof nomenclatureUpdateRequestSchema>;
