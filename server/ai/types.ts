/**
 * Интерфейсы AI-слоя для OCR-пайплайна. Абстрагируют Gemini и Jimp,
 * чтобы OcrService не зависел от конкретных SDK. Реальные реализации — PHASE 4.6.
 */

export interface ParsedInvoiceItem {
  rawName: string;
  quantity: number;
  unitPrice: number;
  lineSum: number;
}

/** Структурированный результат распознавания накладной. */
export interface ParsedInvoice {
  recognizedDate: string;
  supplierName: string;
  totalSum: number;
  detectedVehicle: string;
  items: ParsedInvoiceItem[];
}

export interface OcrRequest {
  base64: string;
  mimeType: string;
  /** Выбранный движок из настроек (aiOcrEngine). */
  engine?: string;
}

export interface OcrResult {
  parsed: ParsedInvoice;
  /** true, если использован резервный/демо-механизм (аналог ocrFallback). */
  fallback: boolean;
  /** Сообщение об ошибке распознавания (аналог ocrError). */
  error?: string;
}

/** Провайдер распознавания (Gemini в 4.6, стабы в тестах). */
export interface OcrProvider {
  recognize(req: OcrRequest): Promise<OcrResult>;
}

export interface PreprocessResult {
  base64: string;
  mimeType: string;
  logs: string[];
}

/** Предобработчик изображения (Jimp в 4.6, no-op в тестах). */
export interface ImagePreprocessor {
  preprocess(base64: string, mimeType: string): Promise<PreprocessResult>;
}

/** Категория OCR-ошибки для маппинга в HTTP-статус на слое transport. */
export type OcrErrorCode = 'NOT_FOUND' | 'IMAGE_MISSING' | 'PROVIDER' | 'STORAGE';

export class OcrError extends Error {
  constructor(
    message: string,
    readonly code?: OcrErrorCode,
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
