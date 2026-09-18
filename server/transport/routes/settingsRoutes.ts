import { Router } from 'express';
import { settingsUpdateRequestSchema } from '../../../shared/index.js';
import { SettingsService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf } from '../routeHelpers.js';

/**
 * Settings routes (PHASE 4.7b.6) поверх SettingsService.
 * GET — любой authenticated; POST — auth + requireRole(['admin']).
 * KI-12 сохраняется: settings_update пишет oldValues=null (в сервисе); транспорт со snapshot не работает.
 */
export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new SettingsService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.get());
  });

  router.post('/', auth, admin, validateBody(settingsUpdateRequestSchema), async (req, res) => {
    const settings = await service.update(req.body, actorOf(req));
    res.status(200).json({ success: true, settings });
  });

  return router;
}
