import { buildAppFromEnv } from '../server/buildApp.js';

/**
 * Vercel-функция бэкенда: ОДИН существующий Express-app обрабатывает все /api/* маршруты
 * (не набор отдельных функций). vercel.json переписывает все запросы на эту функцию.
 * app.listen тут НЕ вызывается — Vercel сам инвокает экспортированный обработчик.
 * Сборка приложения (env → Firebase Admin keyless/WIF → services → CORS) — в buildAppFromEnv().
 */
const app = buildAppFromEnv();
export default app;
