import { z } from 'zod';
import { anomalyFlagTypeSchema, anomalySeveritySchema } from '../enums/index.js';

export const anomalyFlagSchema = z.object({
  id: z.string(),
  invoiceItemId: z.string(),
  invoiceId: z.string(),
  relatedInvoiceId: z.string().optional(),
  flagType: anomalyFlagTypeSchema,
  details: z.string(),
  severity: anomalySeveritySchema,
  isResolved: z.boolean().default(false),
  resolvedBy: z.string().nullable().default(null),
  resolvedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AnomalyFlag = z.infer<typeof anomalyFlagSchema>;
