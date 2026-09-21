import { Router } from 'express';
import {
  nomenclatureCreateRequestSchema,
  nomenclatureUpdateRequestSchema,
  matchQuerySchema,
  type MatchQuery,
} from '../../../shared/index.js';
import { NomenclatureService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody, validateQuery } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf, idParam } from '../routeHelpers.js';

/**
 * Nomenclature routes (PHASE 4.7b.3) поверх NomenclatureService.
 * GET/history/match — любой authenticated; POST/PUT/DELETE — admin (общий доступ к endpoint).
 * ВАЖНО: право менять нормативы проверяет СЕРВИС (boss-only) → FORBIDDEN → 403;
 * requireEditNormatives на транспорте НЕ дублируется, body в транспорте не анализируется.
 * Особенности сервиса (авто-синк GET KI-10, отсутствие recalc KI-11, soft delete) сохраняются.
 */
export function createNomenclatureRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new NomenclatureService(deps.ctx);
  const auth = authenticate(deps.firebaseVerifier, deps.userService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.list());
  });

  router.get('/match', auth, validateQuery(matchQuerySchema), async (req, res) => {
    const { q } = req.validatedQuery as MatchQuery;
    res.status(200).json(await service.match(q ?? ''));
  });

  router.get('/:id/history', auth, async (req, res) => {
    res.status(200).json(await service.history(idParam(req)));
  });

  router.post('/', auth, admin, validateBody(nomenclatureCreateRequestSchema), async (req, res) => {
    const nomenclature = await service.create(req.body, actorOf(req));
    res.status(200).json({ success: true, nomenclature });
  });

  router.put('/:id', auth, admin, validateBody(nomenclatureUpdateRequestSchema), async (req, res) => {
    const nomenclature = await service.update(idParam(req), req.body, actorOf(req));
    res.status(200).json({ success: true, nomenclature });
  });

  router.delete('/:id', auth, admin, async (req, res) => {
    res.status(200).json(await service.softDelete(idParam(req), actorOf(req)));
  });

  return router;
}
