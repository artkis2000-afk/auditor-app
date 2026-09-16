import { z } from 'zod';

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
