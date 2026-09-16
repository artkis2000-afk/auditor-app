import { z } from 'zod';
import { truckPlacementSchema } from '../enums/index.js';

// Позиция во входных данных накладной (до сплита по количеству)
export const invoiceItemInputSchema = z.object({
  id: z.string().optional(),
  rawName: z.string(),
  quantity: z.coerce.number().default(1),
  unitPrice: z.coerce.number().default(0),
  lineSum: z.coerce.number().optional(),
  matchedNomenclatureId: z.string().nullable().optional(),
  vehicleId: z.string().nullable().optional(),
  truckPlacement: truckPlacementSchema.nullable().optional(),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

// Ручное создание накладной
export const manualInvoiceRequestSchema = z.object({
  recognizedDate: z.string().optional(),
  supplierName: z.string().optional(),
  comment: z.string().optional(),
  items: z.array(invoiceItemInputSchema).default([]),
});
export type ManualInvoiceRequest = z.infer<typeof manualInvoiceRequestSchema>;

// Загрузка файла накладной (base64) для OCR
export const invoiceUploadRequestSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  base64: z.string().min(1),
});
export type InvoiceUploadRequest = z.infer<typeof invoiceUploadRequestSchema>;

// Редактирование накладной (PIN нужен для сверенной накладной)
export const invoiceUpdateRequestSchema = z.object({
  recognizedDate: z.string(),
  supplierName: z.string(),
  comment: z.string().optional(),
  items: z.array(invoiceItemInputSchema).default([]),
  pin: z.string().optional(),
});
export type InvoiceUpdateRequest = z.infer<typeof invoiceUpdateRequestSchema>;

// Массовые операции
export const invoiceIdsRequestSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type InvoiceIdsRequest = z.infer<typeof invoiceIdsRequestSchema>;

// Одобрение конкретного флага
export const approveFlagRequestSchema = z.object({
  flagId: z.string().optional(),
  invoiceItemId: z.string().optional(),
  flagType: z.string().optional(),
});
export type ApproveFlagRequest = z.infer<typeof approveFlagRequestSchema>;
