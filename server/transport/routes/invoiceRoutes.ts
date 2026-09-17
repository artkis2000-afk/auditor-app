import { Router, type Request } from 'express';
import {
  manualInvoiceRequestSchema,
  invoiceUpdateRequestSchema,
  invoiceIdsRequestSchema,
  approveFlagRequestSchema,
  invoicesListQuerySchema,
  type InvoicesListQuery,
} from '../../../shared/index.js';
import { InvoiceService, ServiceError } from '../../services/index.js';
import type { AppDeps } from '../deps.js';
import { validateBody, validateQuery } from '../validation.js';
import { authenticate, requireRole, requireApproveAnomaly } from '../authMiddleware.js';

const LIST_IMAGE_PLACEHOLDER = '/assets/invoice_placeholder.png';

function actorOf(req: Request) {
  return req.principal!;
}

function idParam(req: Request): string {
  return req.params.id as string;
}

function extractPin(req: Request): string | undefined {
  const fromBody = (req.body as { pin?: unknown } | undefined)?.pin;
  const fromQuery = (req.query as { pin?: unknown })?.pin;
  const fromHeader = req.headers['x-pin'];
  const pin = fromBody ?? fromQuery ?? fromHeader;
  return pin === undefined ? undefined : String(pin);
}

/**
 * Invoices routes (PHASE 4.7b.2). Бизнес-логика/пересчёт/аудит/PIN — в InvoiceService.
 * Роли: manual → admin|manager (legacy), остальные мутации → admin, approve → boss (requireApproveAnomaly).
 * OCR/upload не реализуются (PHASE 4.6).
 */
export function createInvoiceRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new InvoiceService(deps.ctx);
  const auth = authenticate(deps.authService);
  const admin = requireRole(deps.authorizationService, ['admin']);

  // --- Read ---
  router.get('/', auth, validateQuery(invoicesListQuerySchema), async (req, res) => {
    const q = (req.validatedQuery ?? {}) as InvoicesListQuery;
    const entries = await service.list(q);
    res.status(200).json(entries.map((e) => ({ ...e, imagePath: LIST_IMAGE_PLACEHOLDER })));
  });

  router.get('/:id', auth, async (req, res) => {
    const detail = await service.getById(idParam(req));
    if (!detail) throw new ServiceError('NOT_FOUND', 'Накладная не найдена');
    res.status(200).json({ ...detail, supplier: null, supplierSuggestions: [] });
  });

  // --- Mutations ---
  router.post(
    '/manual',
    auth,
    requireRole(deps.authorizationService, ['admin', 'manager']),
    validateBody(manualInvoiceRequestSchema),
    async (req, res) => {
      const result = await service.createManual(req.body, actorOf(req));
      res.status(200).json({ success: true, ...result });
    },
  );

  router.put('/:id', auth, admin, validateBody(invoiceUpdateRequestSchema), async (req, res) => {
    const result = await service.edit(idParam(req), req.body, actorOf(req));
    res.status(200).json({ success: true, ...result });
  });

  router.post('/:id/confirm', auth, admin, async (req, res) => {
    const result = await service.confirm(idParam(req), actorOf(req));
    res.status(200).json({ success: true, ...result });
  });

  router.delete('/:id', auth, admin, async (req, res) => {
    const result = await service.delete(idParam(req), actorOf(req), extractPin(req));
    res.status(200).json(result);
  });

  router.post('/bulk-delete', auth, admin, validateBody(invoiceIdsRequestSchema), async (req, res) => {
    const result = await service.bulkDelete(req.body.ids, actorOf(req), extractPin(req));
    res.status(200).json({ success: true, ...result });
  });

  router.post('/batch-reconcile', auth, admin, validateBody(invoiceIdsRequestSchema), async (req, res) => {
    const result = await service.reconcile(req.body.ids, actorOf(req));
    res.status(200).json({ success: true, ...result });
  });

  // --- Approve (boss-only через requireApproveAnomaly) ---
  router.post(
    '/:id/approve-flag',
    auth,
    requireApproveAnomaly(deps.authorizationService),
    validateBody(approveFlagRequestSchema),
    async (req, res) => {
      const result = await service.approveFlag(idParam(req), req.body, actorOf(req));
      res.status(200).json(result); // сервис уже возвращает {success,...}
    },
  );

  router.post('/:id/approve-all-flags', auth, requireApproveAnomaly(deps.authorizationService), async (req, res) => {
    const result = await service.approveAllFlags(idParam(req), actorOf(req));
    res.status(200).json(result); // сервис уже возвращает {success,...}
  });

  return router;
}
