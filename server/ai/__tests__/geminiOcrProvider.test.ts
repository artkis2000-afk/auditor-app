import { describe, it, expect } from 'vitest';
import {
  GeminiOcrProvider,
  type GeminiContentClient,
  type GenerateContentParams,
  type GenerateContentResult,
} from '../geminiOcrProvider.js';
import { OcrError, type OcrRequest } from '../types.js';

const REQ: OcrRequest = { base64: 'BASE64IMAGEDATA', mimeType: 'image/jpeg' };
const MODEL = 'gemini-test-model';

const VALID = {
  recognizedDate: '2026-05-15',
  supplierName: 'ООО АвтоСнаб',
  totalSum: 3650,
  detectedVehicle: 'V569',
  items: [{ rawName: 'Фильтр масляный V569', quantity: 1, unitPrice: 1200, lineSum: 1200 }],
};

/** Фейковый клиент Gemini: записывает параметры и отдаёт/бросает по сценарию (номер попытки → результат). */
function fakeClient(behavior: (attempt: number) => GenerateContentResult): {
  client: GeminiContentClient;
  calls: GenerateContentParams[];
} {
  const calls: GenerateContentParams[] = [];
  const client: GeminiContentClient = {
    models: {
      generateContent: async (p) => {
        calls.push(p);
        return behavior(calls.length);
      },
    },
  };
  return { client, calls };
}

function provider(client: GeminiContentClient, maxRetries = 2): GeminiOcrProvider {
  return new GeminiOcrProvider(client, { model: MODEL, maxRetries, baseDelayMs: 1, sleep: async () => {} });
}

describe('GeminiOcrProvider', () => {
  it('валидный structured-ответ → ParsedInvoice; передаёт model/inlineData/JSON-config', async () => {
    const { client, calls } = fakeClient(() => ({ text: JSON.stringify(VALID) }));
    const res = await provider(client).recognize(REQ);

    expect(res.fallback).toBe(false);
    expect(res.parsed.supplierName).toBe('ООО АвтоСнаб');
    expect(res.parsed.items).toHaveLength(1);
    expect(res.parsed.totalSum).toBe(3650);

    // правильный model
    expect(calls[0]!.model).toBe(MODEL);
    // правильный inlineData
    const contents = calls[0]!.contents as Array<Record<string, any>>;
    expect(contents[0]!.inlineData).toEqual({ data: 'BASE64IMAGEDATA', mimeType: 'image/jpeg' });
    // используется JSON structured-output config
    expect(calls[0]!.config.responseMimeType).toBe('application/json');
    expect(calls[0]!.config.responseSchema).toBeDefined();
  });

  it('ответ в markdown-обёртке ```json → корректно парсится', async () => {
    const { client } = fakeClient(() => ({ text: '```json\n' + JSON.stringify(VALID) + '\n```' }));
    const res = await provider(client).recognize(REQ);
    expect(res.parsed.detectedVehicle).toBe('V569');
  });

  it('пустой ответ → OcrError', async () => {
    const { client } = fakeClient(() => ({ text: '' }));
    await expect(provider(client).recognize(REQ)).rejects.toBeInstanceOf(OcrError);
  });

  it('битый JSON → OcrError', async () => {
    const { client } = fakeClient(() => ({ text: '{ это не json' }));
    await expect(provider(client).recognize(REQ)).rejects.toBeInstanceOf(OcrError);
  });

  it('ответ не по схеме (items не массив) → OcrError', async () => {
    const bad = { ...VALID, items: 'нет позиций' };
    const { client } = fakeClient(() => ({ text: JSON.stringify(bad) }));
    await expect(provider(client).recognize(REQ)).rejects.toBeInstanceOf(OcrError);
  });

  it('429 → повтор, затем успех', async () => {
    const { client, calls } = fakeClient((attempt) => {
      if (attempt === 1) throw { status: 429, message: 'rate limited' };
      return { text: JSON.stringify(VALID) };
    });
    const res = await provider(client).recognize(REQ);
    expect(res.parsed.supplierName).toBe('ООО АвтоСнаб');
    expect(calls).toHaveLength(2);
  });

  it('5xx → повтор, затем успех', async () => {
    const { client, calls } = fakeClient((attempt) => {
      if (attempt === 1) throw { status: 503 };
      return { text: JSON.stringify(VALID) };
    });
    await provider(client).recognize(REQ);
    expect(calls).toHaveLength(2);
  });

  it('исчерпание попыток (постоянный 500) → OcrError, ровно maxRetries+1 вызовов', async () => {
    const { client, calls } = fakeClient(() => {
      throw { status: 500 };
    });
    await expect(provider(client, 2).recognize(REQ)).rejects.toBeInstanceOf(OcrError);
    expect(calls).toHaveLength(3);
  });

  it('неперманентная ошибка не ретраится: 400 → OcrError с одной попыткой', async () => {
    const { client, calls } = fakeClient(() => {
      throw { status: 400, message: 'bad request' };
    });
    await expect(provider(client, 2).recognize(REQ)).rejects.toBeInstanceOf(OcrError);
    expect(calls).toHaveLength(1);
  });

  it('секрет/сырой ответ не утекают в сообщение об ошибке', async () => {
    const { client } = fakeClient(() => {
      throw new Error('boom apiKey=SUPERSECRETKEY status 500 x-goog-api-key: SUPERSECRETKEY');
    });
    try {
      await provider(client, 1).recognize(REQ);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OcrError);
      expect((err as OcrError).message).not.toContain('SUPERSECRETKEY');
      expect((err as OcrError).message).not.toContain('apiKey');
    }
  });
});
