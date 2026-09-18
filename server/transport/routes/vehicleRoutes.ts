import { Router } from 'express';
import {
  vehicleUpsertRequestSchema,
  trailerUpsertRequestSchema,
  trailerSwapRequestSchema,
  vehicleExclusionToggleRequestSchema,
} from '../../../shared/index.js';
import { VehicleService } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody } from '../validation.js';
import { authenticate, requireRole } from '../authMiddleware.js';
import { actorOf, idParam } from '../routeHelpers.js';

/**
 * Vehicles/trailers routes (PHASE 4.7b.4) поверх VehicleService.
 * GET — любой authenticated; все мутации — requireRole(['admin']) (закрываем KI-15).
 * Бизнес-логика (отвязка номенклатуры, перецепка) — в сервисе.
 */
export function createVehicleRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new VehicleService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.list());
  });

  router.post('/swap-trailers', auth, admin, validateBody(trailerSwapRequestSchema), async (req, res) => {
    res.status(200).json(await service.swapTrailers(req.body, actorOf(req)));
  });

  router.post('/', auth, admin, validateBody(vehicleUpsertRequestSchema), async (req, res) => {
    const vehicle = await service.upsert(req.body, actorOf(req));
    res.status(200).json({ success: true, vehicle, vehicles: await service.list() });
  });

  router.delete('/:id', auth, admin, async (req, res) => {
    await service.delete(idParam(req), actorOf(req));
    res.status(200).json({ success: true, vehicles: await service.list() });
  });

  router.post('/:id/trailer', auth, admin, validateBody(trailerUpsertRequestSchema), async (req, res) => {
    const vehicle = await service.addTrailer(idParam(req), req.body, actorOf(req));
    res.status(200).json({ success: true, vehicle, vehicles: await service.list() });
  });

  router.delete('/:id/trailer', auth, admin, async (req, res) => {
    const vehicle = await service.deleteTrailer(idParam(req), actorOf(req));
    res.status(200).json({ success: true, vehicle, vehicles: await service.list() });
  });

  return router;
}

/** Исключения машин из распределения общего склада (/api/vehicle-exclusions). */
export function createVehicleExclusionsRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new VehicleService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  router.get('/', auth, async (_req, res) => {
    res.status(200).json(await service.listExclusions());
  });

  router.post('/', auth, admin, validateBody(vehicleExclusionToggleRequestSchema), async (req, res) => {
    const exclusions = await service.toggleExclusion(req.body, actorOf(req));
    res.status(200).json({ success: true, exclusions });
  });

  return router;
}
