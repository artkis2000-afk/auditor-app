import { z } from 'zod';

/** Query для эндпоинтов подбора (?q=...). Общий для suppliers/nomenclature match. */
export const matchQuerySchema = z.object({
  q: z.string().optional(),
});
export type MatchQuery = z.infer<typeof matchQuerySchema>;

export const supplierCreateRequestSchema = z.object({
  name: z.string().min(1),
  legalAddress: z.string().optional(),
  inn: z.string().min(1),
  isApproved: z.boolean().optional(),
  notes: z.string().optional(),
});
export type SupplierCreateRequest = z.infer<typeof supplierCreateRequestSchema>;

export const supplierUpdateRequestSchema = supplierCreateRequestSchema.extend({
  isApproved: z.boolean().optional(),
});
export type SupplierUpdateRequest = z.infer<typeof supplierUpdateRequestSchema>;
