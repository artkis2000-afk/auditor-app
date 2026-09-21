import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { authenticate } from '../authMiddleware.js';

/**
 * Auth routes (PHASE 5.1: Firebase identity).
 * Кастомный /login удалён — вход выполняется на фронте через Firebase (Google/email-password).
 * GET /me: проверяет Firebase ID-токен, при первом входе создаёт users/{uid}, возвращает профиль.
 */
export function createAuthRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/me', authenticate(deps.firebaseVerifier, deps.userService), (req, res) => {
    res.status(200).json({ user: req.principal });
  });

  return router;
}
