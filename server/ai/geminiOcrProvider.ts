import { GoogleGenAI } from '@google/genai';
import { OcrError, type OcrProvider, type OcrRequest, type OcrResult } from './types.js';
import { parsedInvoiceSchema } from './parsedInvoiceSchema.js';
import { INVOICE_OCR_PROMPT, INVOICE_OCR_RESPONSE_SCHEMA } from './geminiPrompt.js';

/**
 * Минимальная структурная граница вокруг клиента Gemini — позволяет юнит-тестировать
 * провайдер без реального API/ключа (внедряется фейковый client).
 */
export interface GenerateContentParams {
  model: string;
  contents: unknown;
  config: { responseMimeType: string; responseSchema: unknown };
}
export interface GenerateContentResult {
  text?: string;
}
export interface GeminiContentClient {
  models: { generateContent(params: GenerateContentParams): Promise<GenerateContentResult> };
}

export interface GeminiOcrProviderOptions {
  model: string;
  /** Максимум ПОВТОРНЫХ попыток после первой (итого попыток = maxRetries+1). По умолчанию 2. */
  maxRetries?: number;
  /** Базовая задержка backoff, мс (экспоненциально растёт). По умолчанию 500. */
  baseDelayMs?: number;
  /** Инъекция сна (для тестов — no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Достаёт HTTP-статус из ошибки SDK, не завися от конкретного класса ошибки. */
function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.code === 'number') return e.code;
    if (typeof e.status === 'string') {
      const n = Number.parseInt(e.status, 10);
      if (!Number.isNaN(n)) return n;
    }
    if (typeof e.message === 'string') {
      const m = e.message.match(/\b(4\d\d|5\d\d)\b/);
      if (m) return Number.parseInt(m[1]!, 10);
    }
  }
  return undefined;
}

function isTransient(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

/**
 * OCR-провайдер поверх Gemini (@google/genai). Реализует существующий OcrProvider:
 * image + prompt → structured ParsedInvoice. Единственное место, знающее про SDK Gemini.
 * НЕ знает Firestore/InvoiceService/HTTP/ImageStore и НЕ читает env самостоятельно.
 *
 * Границы ошибок: любые сбои Gemini/парсинга → OcrError с обезличенным сообщением
 * (без ключа, raw-ответа, stack, заголовков). Fallback выполняет вызывающий OcrService.
 */
export class GeminiOcrProvider implements OcrProvider {
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly client: GeminiContentClient,
    opts: GeminiOcrProviderOptions,
  ) {
    this.model = opts.model;
    this.maxRetries = opts.maxRetries ?? 2;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async recognize(req: OcrRequest): Promise<OcrResult> {
    const params: GenerateContentParams = {
      model: this.model,
      contents: [
        { inlineData: { data: req.base64, mimeType: req.mimeType } },
        { text: INVOICE_OCR_PROMPT },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: INVOICE_OCR_RESPONSE_SCHEMA,
      },
    };

    const result = await this.callWithRetry(params);

    const text = (result.text ?? '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    if (!text) throw new OcrError('Gemini вернул пустой ответ');

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new OcrError('Не удалось разобрать JSON-ответ Gemini');
    }

    const parsed = parsedInvoiceSchema.safeParse(json);
    if (!parsed.success) {
      throw new OcrError('Ответ Gemini не соответствует ожидаемой схеме накладной');
    }

    return { parsed: parsed.data, fallback: false };
  }

  private async callWithRetry(params: GenerateContentParams): Promise<GenerateContentResult> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.client.models.generateContent(params);
      } catch (err) {
        const status = extractStatus(err);
        if (!isTransient(status) || attempt === this.maxRetries) {
          throw new OcrError(`Ошибка распознавания Gemini${status ? ` (HTTP ${status})` : ''}`);
        }
        await this.sleep(this.baseDelayMs * 2 ** attempt);
      }
    }
    // недостижимо: цикл всегда либо возвращает, либо бросает
    throw new OcrError('Распознавание Gemini не удалось');
  }
}

/**
 * Фабрика реального Gemini-провайдера. Ключ приходит явно (не из env),
 * поэтому здесь — валидация наличия ключа; создаётся только в composition root.
 */
export function createGeminiOcrProvider(config: {
  apiKey: string;
  model: string;
  maxRetries?: number;
  baseDelayMs?: number;
}): GeminiOcrProvider {
  if (!config.apiKey) {
    throw new OcrError('Не задан ключ Gemini API для реального OCR-провайдера');
  }
  const client = new GoogleGenAI({ apiKey: config.apiKey }) as unknown as GeminiContentClient;
  return new GeminiOcrProvider(client, {
    model: config.model,
    maxRetries: config.maxRetries,
    baseDelayMs: config.baseDelayMs,
  });
}
