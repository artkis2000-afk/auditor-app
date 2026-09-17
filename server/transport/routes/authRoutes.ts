import { Router } from 'express';
import { loginRequestSchema } from '../../../shared/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody } from '../validation.js';
import { authenticate } from '../authMiddleware.js';

/**
 * Auth routes (перенос /api/auth/login и /api/auth/me). Бизнес-логика — в AuthService.
 * Формат ответа legacy-совместимый: login → {token,user}, me → {user}.
 */
export function createAuthRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/login', validateBody(loginRequestSchema), async (req, res, next) => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      const result = await deps.authService.login(username, password);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', authenticate(deps.authService), (req, res) => {
    res.status(200).json({ user: req.principal });
  });

  return router;
}
