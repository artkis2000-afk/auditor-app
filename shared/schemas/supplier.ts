import { z } from 'zod';

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  legalAddress: z.string().default(''),
  inn: z.string(),
  isApproved: z.boolean().default(true),
  notes: z.string().default(''),
  createdBy: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
});
export type Supplier = z.infer<typeof supplierSchema>;
