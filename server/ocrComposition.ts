import {
  loadAiConfig,
  createGeminiOcrProvider,
  DeterministicMockOcrProvider,
  PassthroughImagePreprocessor,
  type OcrProvider,
} from './ai/index.js';
import type { OcrServiceDeps } from './services/index.js';
import type { ImageStore } from './storage/index.js';

/**
 * Политика production-fallback (KI-22) для сборки OCR-зависимостей:
 *  - есть GEMINI_API_KEY → реальный Gemini как primary;
 *  - production БЕЗ ключа → бросаем ошибку (никакого молчаливого fake OCR);
 *  - non-production без ключа → детерминированный демо-fallback (dev-режим);
 *  - в production fallback НЕ подключается — сбой Gemini уводит накладную в ошибку, не в фейк.
 * Jimp не подключаем (4.6b): preprocessor — passthrough.
 */
export function buildOcrDeps(
  imageStore: ImageStore | undefined,
  isProd: boolean,
  env: NodeJS.ProcessEnv = process.env,
): OcrServiceDeps {
  const ai = loadAiConfig(env);
  const preprocessor = new PassthroughImagePreprocessor();

  let primary: OcrProvider | undefined;
  if (ai.geminiApiKey) {
    primary = createGeminiOcrProvider({ apiKey: ai.geminiApiKey, model: ai.geminiModel });
  }

  let fallback: OcrProvider | undefined;
  if (isProd) {
    if (!primary) {
      throw new Error('В production требуется GEMINI_API_KEY: молчаливый fake OCR запрещён (KI-22).');
    }
    // fallback намеренно не подключается в production
  } else if (!primary) {
    fallback = new DeterministicMockOcrProvider(); // dev/non-prod демо-режим
  }

  return { primary, fallback, preprocessor, imageStore };
}
