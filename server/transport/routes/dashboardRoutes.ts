import { Router } from 'express';
import { dashboardPeriodQuerySchema, type DashboardPeriodQuery } from '../../../shared/index.js';
import { DashboardService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateQuery } from '../validation.js';
import { authenticate } from '../authMiddleware.js';

/**
 * Dashboard route (PHASE 4.7b.5) поверх DashboardService.
 * GET /api/dashboard/stats — authentication; расчёты статистики/аномалий/финансов — в сервисе.
 */
export function createDashboardRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new DashboardService(deps.ctx);
  const auth = authenticate(deps.authService);

  router.get('/stats', auth, validateQuery(dashboardPeriodQuerySchema), async (req, res) => {
    const query = (req.validatedQuery ?? {}) as DashboardPeriodQuery;
    res.status(200).json(await service.getStats(query));
  });

  return router;
}
