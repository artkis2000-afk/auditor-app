import type { Express } from 'express';
import type { FirestoreGateway } from './db/index.js';
import { createServiceContext, type OcrServiceDeps } from './services/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from './auth/index.js';
import type { ImageStore } from './storage/index.js';
import { createApp } from './transport/index.js';

/** Дополнительные (опциональные) зависимости для upload/OCR. Собираются в index.ts / стабятся в тестах. */
export interface ComposeOptions {
  ocr?: OcrServiceDeps;
  imageStore?: ImageStore;
}

/**
 * Сборка Express-приложения из production-style DI-графа:
 * gateway → ServiceContext → services → auth services → createApp(deps).
 *
 * Чистая функция без сайд-эффектов и без обращения к env: composition root (index.ts)
 * передаёт реальный Admin-gateway, секрет и OCR/storage-зависимости, а тесты — in-memory gateway,
 * тестовый секрет и стабы. Так createApp() остаётся DI-friendly и тестируемым без Firestore/Gemini.
 * Секрет приходит параметром (из env), без захардкоженного дефолта (KI-13).
 */
export function composeApp(gateway: FirestoreGateway, jwtSecret: string, opts: ComposeOptions = {}): Express {
  const ctx = createServiceContext(gateway);
  const tokenService = new TokenService(jwtSecret);
  const authService = new AuthService(ctx, tokenService, new Sha256Hasher());
  const authorizationService = new AuthorizationService();
  return createApp({
    ctx,
    authService,
    authorizationService,
    tokenService,
    ocr: opts.ocr,
    imageStore: opts.imageStore,
  });
}
