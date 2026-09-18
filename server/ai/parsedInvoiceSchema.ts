import { z } from 'zod';
import type { ParsedInvoice } from './types.js';

/**
 * Zod-валидация ответа OCR-провайдера на границе AI-слоя.
 * Форма строго соответствует ParsedInvoice (server/ai/types.ts). Числа приводятся
 * (Gemini может вернуть строку), detectedVehicle терпимо приводится к '' при отсутствии.
 * Нарушение структуры (нет items / items не массив / rawName не строка) → ошибка валидации.
 */
export const parsedInvoiceItemSchema = z.object({
  rawName: z.string(),
  quantity: z.coerce.number(),
  unitPrice: z.coerce.number(),
  lineSum: z.coerce.number(),
});

export const parsedInvoiceSchema = z.object({
  recognizedDate: z.string(),
  supplierName: z.string(),
  totalSum: z.coerce.number(),
  detectedVehicle: z.string().catch(''),
  items: z.array(parsedInvoiceItemSchema),
});

// Проверка соответствия типу ParsedInvoice на этапе компиляции.
type _AssertShape = z.infer<typeof parsedInvoiceSchema> extends ParsedInvoice ? true : never;
const _assert: _AssertShape = true;
void _assert;
