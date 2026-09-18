import type { Express } from 'express';
import type { Server } from 'node:http';
import { getFirestoreGateway } from './db/index.js';
import { loadFirebaseEnv } from './db/env.js';
import { loadAuthConfig } from './auth/index.js';
import { createFirebaseStorageGateway } from './storage/index.js';
import { buildOcrDeps } from './ocrComposition.js';
import { composeApp } from './composeApp.js';

/**
 * Composition root процесса: env/config → Admin Firestore Gateway → ServiceContext →
 * services → auth → OCR/storage → createApp → app.listen. Бизнес-логики здесь нет — только связывание.
 *
 * Ошибки конфигурации (нет JWT_SECRET / Firebase-кредов / storage-бакета / Gemini-ключа в prod)
 * понятны разработчику в логах и НЕ уходят HTTP-клиенту: процесс не стартует (exit 1) до открытия порта.
 */
function buildApp(): Express {
  const { jwtSecret } = loadAuthConfig(); // JWT_SECRET только из env, без дефолта (KI-13)
  const firebaseEnv = loadFirebaseEnv(); // FIREBASE_* env (единый источник конфигурации)
  const gateway = getFirestoreGateway(); // Admin SDK (единственный клиент)
  const imageStore = createFirebaseStorageGateway(firebaseEnv); // Firebase Storage (тот же Admin app)
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  const ocr = buildOcrDeps(imageStore, isProd);
  return composeApp(gateway, jwtSecret, { ocr, imageStore });
}

function start(): void {
  let app: Express;
  try {
    app = buildApp();
  } catch (err) {
    console.error(
      '[startup] Ошибка конфигурации, сервер не запущен:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 3000;
  const server: Server = app.listen(port, () => {
    console.log(`[server] Слушает http://localhost:${port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`[shutdown] Получен ${signal}, закрываю HTTP-сервер…`);
    server.close((err) => {
      if (err) {
        console.error('[shutdown] Ошибка при закрытии сервера:', err);
        process.exit(1);
      }
      process.exit(0);
    });
    // Страховка: если открытые соединения не закрылись — принудительный выход.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
