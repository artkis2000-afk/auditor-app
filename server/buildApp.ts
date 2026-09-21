import type { Express } from 'express';
import { getFirestoreGateway } from './db/index.js';
import { loadFirebaseEnv } from './db/env.js';
import { loadAuthConfig } from './auth/index.js';
import { createFirebaseStorageGateway } from './storage/index.js';
import { buildOcrDeps } from './ocrComposition.js';
import { composeApp } from './composeApp.js';

/** Разбирает WEB_ORIGIN (список origin через запятую) в массив для CORS-allowlist. */
export function parseWebOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Composition root из окружения: env/config → Firestore Gateway (@google-cloud/firestore, keyless: ADC/WIF) →
 * ServiceContext → services → auth → OCR/storage → CORS → createApp.
 * Возвращает готовый Express app БЕЗ app.listen — используется и локальным сервером (server/index.ts),
 * и Vercel-функцией (api/index.ts). Бизнес-логики здесь нет.
 *
 * Ошибки конфигурации (нет JWT_SECRET / storage-бакета / Gemini-ключа в prod)
 * бросаются наружу: локально → лог+exit(1) до открытия порта; на Vercel → 500 холодного старта.
 */
export function buildAppFromEnv(): Express {
  const { jwtSecret } = loadAuthConfig(); // JWT_SECRET только из env, без дефолта (KI-13)
  const firebaseEnv = loadFirebaseEnv(); // FIREBASE_*/GCP_* env (keyless: ADC локально, WIF на Vercel)
  const gateway = getFirestoreGateway(); // @google-cloud/firestore (единый auth-адаптер)
  const imageStore = createFirebaseStorageGateway(firebaseEnv); // @google-cloud/storage (тот же общий конфиг)
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  const ocr = buildOcrDeps(imageStore, isProd);
  const corsOrigins = parseWebOrigins();
  return composeApp(gateway, jwtSecret, { ocr, imageStore, corsOrigins });
}
