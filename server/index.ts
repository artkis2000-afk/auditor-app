import type { Express } from 'express';
import type { Server } from 'node:http';
import { buildAppFromEnv } from './buildApp.js';

/**
 * Локальный dev/standalone-запуск: собирает Express через buildAppFromEnv() и слушает порт.
 * Vercel использует ту же сборку через api/index.ts (без app.listen).
 */
function start(): void {
  let app: Express;
  try {
    app = buildAppFromEnv();
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
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
