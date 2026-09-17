import express, { type Express } from 'express';
import './types.js'; // расширение Express.Request (principal)
import type { AppDeps } from './deps.js';
import { errorHandler } from './errors.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';

/**
 * Фабрика Express-приложения (DI). Цепочка: request → validation → auth → authorization → service → response.
 * Routes не импортируют firebase-admin и не работают с repositories напрямую.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' })); // как в legacy (base64-изображения)

  app.use('/api', createHealthRouter());
  app.use('/api/auth', createAuthRouter(deps));

  // Центральный обработчик ошибок — последним
  app.use(errorHandler());
  return app;
}
