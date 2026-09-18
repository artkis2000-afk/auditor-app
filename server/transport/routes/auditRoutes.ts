import { Router } from 'express';
import { AuditService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf, idParam } from '../routeHelpers.js';

/**
 * Audit routes (PHASE 4.7b.6) поверх AuditService.
 * GET — auth + requireRole(['admin']); rollback — auth + admin, только :id (тело не требуется).
 * Rollback-логика/поддерживаемые действия — в AuditService; unsupported → ServiceError('UNSUPPORTED') → 400.
 */
export function createAuditRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new AuditService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, admin, async (_req, res) => {
    res.status(200).json(await service.list());
  });

  router.post('/:id/rollback', auth, admin, async (req, res) => {
    res.status(200).json(await service.rollback(idParam(req), actorOf(req)));
  });

  return router;
}
