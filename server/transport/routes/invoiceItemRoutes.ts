import { Router } from 'express';
import { placementUpdateRequestSchema } from '../../../shared/index.js';
import { InvoiceItemService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf, idParam } from '../routeHelpers.js';

/**
 * Invoice-items routes (PHASE 4.7b.4) поверх InvoiceItemService.
 * GET — любой authenticated; placement — auth + requireRole(['admin']).
 * Пересчёт аномалий при смене размещения — в сервисе (не в route).
 */
export function createInvoiceItemRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new InvoiceItemService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.getAll());
  });

  router.put('/:id/placement', auth, admin, validateBody(placementUpdateRequestSchema), async (req, res) => {
    res.status(200).json(await service.updatePlacement(idParam(req), req.body, actorOf(req)));
  });

  return router;
}
