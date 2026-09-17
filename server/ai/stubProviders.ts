import type { ImagePreprocessor, OcrProvider, OcrRequest, OcrResult, ParsedInvoice, PreprocessResult } from './types.js';

/** Провайдер, возвращающий заранее заданный результат (для тестов). */
export class StubOcrProvider implements OcrProvider {
  constructor(
    private readonly parsed: ParsedInvoice,
    private readonly opts: { fallback?: boolean; error?: string } = {},
  ) {}

  async recognize(_req: OcrRequest): Promise<OcrResult> {
    return { parsed: this.parsed, fallback: this.opts.fallback ?? false, error: this.opts.error };
  }
}

/** Провайдер, всегда бросающий ошибку (для проверки fallback-пути). */
export class ThrowingOcrProvider implements OcrProvider {
  constructor(private readonly message = 'OCR provider failed') {}

  async recognize(_req: OcrRequest): Promise<OcrResult> {
    throw new Error(this.message);
  }
}

/**
 * Детерминированный демо-провайдер (без Math.random) — резерв/тесты.
 * Аналог мок-OCR оригинала, но со стабильным результатом.
 */
export class DeterministicMockOcrProvider implements OcrProvider {
  constructor(private readonly opts: { supplierName?: string } = {}) {}

  async recognize(_req: OcrRequest): Promise<OcrResult> {
    const parsed: ParsedInvoice = {
      recognizedDate: '2026-07-20',
      supplierName: this.opts.supplierName ?? 'ООО АвтоСнаб',
      totalSum: 3650,
      detectedVehicle: 'V569',
      items: [
        { rawName: 'Фильтр масляный ДВС V569', quantity: 1, unitPrice: 1200, lineSum: 1200 },
        { rawName: 'Колодки тормозные перед. V569', quantity: 1, unitPrice: 2450, lineSum: 2450 },
      ],
    };
    return { parsed, fallback: true };
  }
}

/** Предобработчик без изменений (тестовый режим). */
export class PassthroughImagePreprocessor implements ImagePreprocessor {
  async preprocess(base64: string, mimeType: string): Promise<PreprocessResult> {
    return { base64, mimeType, logs: ['[Passthrough] предобработка пропущена (тестовый режим)'] };
  }
}
