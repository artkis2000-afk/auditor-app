import { z } from 'zod';
import { invoiceStatusSchema, truckPlacementSchema } from '../enums/index.js';

/**
 * Строка накладной. После сплита по количеству quantity всегда = 1 (см. domain/placement).
 * Денормализованные поля (invoiceDate/invoiceStatus/supplierId/supplierName) — PHASE 3:
 * нужны для запросов движка аномалий к одной коллекции без JOIN (Firestore).
 * Они optional для обратной совместимости: у старых документов их нет — заполняются
 * ленивым идемпотентным бэкфиллом на этапе репозиториев.
 */
export const invoiceItemSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  nomenclatureId: z.string().nullable().default(null),
  rawName: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  lineSum: z.number(),
  matchedNomenclatureId: z.string().nullable().default(null),
  vehicleId: z.string().nullable().optional(),
  truckPlacement: truckPlacementSchema.nullable().optional(),

  // --- денормализация (PHASE 3, optional для совместимости) ---
  invoiceDate: z.string().optional(),
  invoiceStatus: invoiceStatusSchema.optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;
