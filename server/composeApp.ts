import type { Express } from 'express';
import type { FirestoreGateway } from './db/index.js';
import { createServiceContext } from './services/index.js';
import { AuthService, TokenService, AuthorizationService, Sha256Hasher } from './auth/index.js';
import { createApp } from './transport/index.js';

/**
 * Сборка Express-приложения из production-style DI-графа:
 * gateway → ServiceContext → services → auth services → createApp(deps).
 *
 * Чистая функция без сайд-эффектов и без обращения к env: composition root (index.ts)
 * передаёт реальный Admin-gateway и секрет из окружения, а тесты — in-memory gateway
 * и тестовый секрет. Так createApp() остаётся DI-friendly и тестируемым без Firestore.
 * Секрет приходит параметром (из env), без захардкоженного дефолта (KI-13).
 */
export function composeApp(gateway: FirestoreGateway, jwtSecret: string): Express {
  const ctx = createServiceContext(gateway);
  const tokenService = new TokenService(jwtSecret);
  const authService = new AuthService(ctx, tokenService, new Sha256Hasher());
  const authorizationService = new AuthorizationService();
  return createApp({ ctx, authService, authorizationService, tokenService });
}
