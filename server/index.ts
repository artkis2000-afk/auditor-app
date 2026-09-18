import type { Express } from 'express';
import type { Server } from 'node:http';
import { getFirestoreGateway } from './db/index.js';
import { loadAuthConfig } from './auth/index.js';
import { composeApp } from './composeApp.js';

/**
 * Composition root процесса: env/config → Admin Firestore Gateway → ServiceContext →
 * services → auth services → createApp → app.listen. Бизнес-логики здесь нет — только связывание.
 *
 * Ошибки конфигурации (нет JWT_SECRET / нет Firebase-кредов) понятны разработчику в логах
 * и НЕ уходят HTTP-клиенту: процесс просто не стартует (exit 1) до открытия порта.
 */
function buildApp(): Express {
  const { jwtSecret } = loadAuthConfig(); // JWT_SECRET только из env, без дефолта (KI-13)
  const gateway = getFirestoreGateway(); // Admin SDK из FIREBASE_* env (единственный клиент)
  return composeApp(gateway, jwtSecret);
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
