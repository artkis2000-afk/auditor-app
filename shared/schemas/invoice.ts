import { z } from 'zod';
import { invoiceStatusSchema } from '../enums/index.js';

export const invoiceSchema = z.object({
  id: z.string(),
  // base64 хранится только транзиентно (в статусе processing), после OCR очищается
  imagePath: z.string().default(''),
  recognizedDate: z.string(),
  status: invoiceStatusSchema,
  uploadedBy: z.string(),
  supplierId: z.string().nullable().default(null),
  rawSupplierName: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  totalSum: z.number().default(0),
  filename: z.string().nullable().optional(),
  ocrFallback: z.boolean().optional(),
  ocrError: z.string().optional(),
  comment: z.string().nullable().optional(),
  isReconciled: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
});
export type Invoice = z.infer<typeof invoiceSchema>;
