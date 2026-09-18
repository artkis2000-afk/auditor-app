/**
 * Конфигурация AI-слоя из окружения. Ключ Gemini НЕОБЯЗАТЕЛЕН: без него тесты и dev-запуск
 * работают на stub/fallback-провайдере. Реальный Gemini-провайдер (см. createGeminiOcrProvider)
 * требует ключ и создаётся только в production composition root, когда ключ присутствует.
 *
 * Модель конфигурируема (GEMINI_OCR_MODEL) со стабильным дефолтом; id не захардкожен в провайдере.
 */
export const DEFAULT_GEMINI_OCR_MODEL = 'gemini-3.8-flash';

// Плейсхолдеры из .env.example / legacy — трактуем как «ключ не задан».
const PLACEHOLDER_KEYS = new Set(['YOUR_GEMINI_API_KEY', 'MY_GEMINI_API_KEY', 'change-me']);

export interface AiConfig {
  /** Ключ Gemini, если реально задан (плейсхолдеры отбрасываются). */
  geminiApiKey?: string;
  /** Id модели Gemini для OCR. */
  geminiModel: string;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const rawKey = env.GEMINI_API_KEY?.trim();
  const geminiApiKey = rawKey && !PLACEHOLDER_KEYS.has(rawKey) ? rawKey : undefined;
  const geminiModel = env.GEMINI_OCR_MODEL?.trim() || DEFAULT_GEMINI_OCR_MODEL;
  return { geminiApiKey, geminiModel };
}
