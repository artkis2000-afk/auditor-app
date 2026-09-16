import { z } from 'zod';
import { truckPlacementSchema } from '../enums/index.js';

export const nomenclatureSchema = z.object({
  id: z.string(),
  normalizedName: z.string(),
  category: z.string().default(''),
  // 0 = срок службы не контролируется (проверка дубликатов отключена)
  normativeServiceDays: z.number().default(0),
  normativeLifespanText: z.string().optional(),
  notes: z.string().default(''),
  truckPlacement: truckPlacementSchema.optional(),
  vehicleId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
});
export type Nomenclature = z.infer<typeof nomenclatureSchema>;

export const nomenclatureAliasSchema = z.object({
  id: z.string(),
  nomenclatureId: z.string(),
  aliasName: z.string(),
});
export type NomenclatureAlias = z.infer<typeof nomenclatureAliasSchema>;
