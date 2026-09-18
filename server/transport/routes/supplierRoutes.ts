import { Router } from 'express';
import { supplierCreateRequestSchema, supplierUpdateRequestSchema, matchQuerySchema, type MatchQuery } from '../../../shared/index.js';
import { SupplierService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody, validateQuery } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf, idParam } from '../routeHelpers.js';

/**
 * Suppliers routes (PHASE 4.7b.3) поверх SupplierService.
 * GET/match — любой authenticated; POST/PUT/DELETE — admin. Уникальность ИНН/аудит — в сервисе.
 */
export function createSupplierRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new SupplierService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.list());
  });

  router.get('/match', auth, validateQuery(matchQuerySchema), async (req, res) => {
    const { q } = req.validatedQuery as MatchQuery;
    res.status(200).json(await service.match(q ?? ''));
  });

  router.post('/', auth, admin, validateBody(supplierCreateRequestSchema), async (req, res) => {
    const supplier = await service.create(req.body, actorOf(req));
    res.status(200).json({ success: true, supplier });
  });

  router.put('/:id', auth, admin, validateBody(supplierUpdateRequestSchema), async (req, res) => {
    const supplier = await service.update(idParam(req), req.body, actorOf(req));
    res.status(200).json({ success: true, supplier });
  });

  router.delete('/:id', auth, admin, async (req, res) => {
    res.status(200).json(await service.softDelete(idParam(req), actorOf(req)));
  });

  return router;
}
