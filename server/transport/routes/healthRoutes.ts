import { Router } from 'express';

/**
 * Liveness/status приложения. БЕЗ аутентификации. Максимально минимальный и безопасный ответ.
 * НЕ проверяет Firestore/креды/env и не раскрывает внутреннее состояние (см. KI-16).
 */
export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return router;
}
