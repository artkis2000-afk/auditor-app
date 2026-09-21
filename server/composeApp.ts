import type { Express } from 'express';
import type { FirestoreGateway } from './db/index.js';
import { createServiceContext, UserService, type OcrServiceDeps } from './services/index.js';
import { AuthorizationService, createFirebaseTokenVerifier } from './auth/index.js';
import type { ImageStore } from './storage/index.js';
import { createApp } from './transport/index.js';

/** Дополнительные (опциональные) зависимости для upload/OCR/CORS. */
export interface ComposeOptions {
  ocr?: OcrServiceDeps;
  imageStore?: ImageStore;
  corsOrigins?: string[];
}

/** Конфигурация Firebase-аутентификации для сборки приложения. */
export interface ComposeAuthConfig {
  projectId: string;
  adminEmails: string[];
}

/**
 * Сборка Express-приложения из production-style DI-графа (PHASE 5.1: Firebase identity):
 * gateway → ServiceContext → UserService + FirebaseTokenVerifier → createApp(deps).
 *
 * Чистая функция без сайд-эффектов и без обращения к env: composition root (buildApp.ts)
 * передаёт реальный gateway/конфиг/OCR/storage, а тесты — in-memory gateway и стабы.
 * Секретов не требует: ID-токен проверяется публичными ключами Google (keyless).
 */
export function composeApp(
  gateway: FirestoreGateway,
  auth: ComposeAuthConfig,
  opts: ComposeOptions = {},
): Express {
  const ctx = createServiceContext(gateway);
  const firebaseVerifier = createFirebaseTokenVerifier({ projectId: auth.projectId });
  const userService = new UserService(ctx, { adminEmails: auth.adminEmails });
  const authorizationService = new AuthorizationService();
  return createApp({
    ctx,
    firebaseVerifier,
    userService,
    authorizationService,
    ocr: opts.ocr,
    imageStore: opts.imageStore,
    corsOrigins: opts.corsOrigins,
  });
}
