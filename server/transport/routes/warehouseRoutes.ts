import { Router } from 'express';
import { warehouseAddRequestSchema, warehouseAllocateRequestSchema } from '../../../shared/index.js';
import { WarehouseService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf } from '../routeHelpers.js';

/**
 * Warehouse routes (PHASE 4.7b.4) поверх WarehouseService.
 * Обе операции — auth + requireRole(['admin']). Аллокация/сплит/остатки — в сервисе.
 */
export function createWarehouseRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new WarehouseService(deps.ctx);
  const auth = authenticate(deps.firebaseVerifier, deps.userService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.post('/add', auth, admin, validateBody(warehouseAddRequestSchema), async (req, res) => {
    const item = await service.add(req.body, actorOf(req));
    res.status(200).json({ success: true, item });
  });

  router.post('/allocate', auth, admin, validateBody(warehouseAllocateRequestSchema), async (req, res) => {
    res.status(200).json(await service.allocate(req.body, actorOf(req)));
  });

  return router;
}
