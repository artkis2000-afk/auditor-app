import { Router, type Request } from 'express';
import {
  manualInvoiceRequestSchema,
  invoiceUpdateRequestSchema,
  invoiceUploadRequestSchema,
  invoiceIdsRequestSchema,
  approveFlagRequestSchema,
  invoicesListQuerySchema,
  type InvoicesListQuery,
} from '../../../shared/index.js';
import { InvoiceService, OcrService, ServiceError } from '../../services/index.js';
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
 * Роли (legacy-семантика): manual/upload → admin|manager; initial OCR идёт СЕРВЕРНО внутри upload
 * (для admin|manager); ручной re-OCR POST /:id/ocr → admin-only; confirm/edit/delete → admin;
 * approve → boss (requireApproveAnomaly). Бизнес-логика/OCR — в InvoiceService/OcrService.
 */
export function createInvoiceRouter(deps: AppDeps): Router {
  const router = Router();
  const service = new InvoiceService(deps.ctx);
  const auth = authenticate(deps.firebaseVerifier, deps.userService);
  const admin = requireRole(deps.authorizationService, ['admin']);
  const uploader = requireRole(deps.authorizationService, ['admin', 'manager']);

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

  // Оригинал изображения накладной (auth). Стрим из ImageStore; base64 в ответе/Firestore нет.
  router.get('/:id/image', auth, async (req, res) => {
    const imageStore = deps.imageStore;
    if (!imageStore) throw new Error('ImageStore не сконфигурирован');
    const img = await service.getImage(idParam(req), imageStore);
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).send(img.data);
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

  // Загрузка изображения (admin|manager). Initial OCR запускается СЕРВЕРНО сразу после создания —
  // как в legacy (авто-OCR по загрузке для любого загрузившего). Синхронно, best-effort:
  // при сбое OCR накладная остаётся (draft+ocrError), upload считается успешным.
  router.post(
    '/upload',
    auth,
    uploader,
    validateBody(invoiceUploadRequestSchema),
    async (req, res) => {
      const imageStore = deps.imageStore;
      if (!imageStore) throw new Error('ImageStore не сконфигурирован'); // → 500 (config); в проде всегда собран
      const actor = actorOf(req);
      const created = await service.createFromUpload(req.body, actor, imageStore);

      let status = created.status;
      if (deps.ocr) {
        try {
          const outcome = await new OcrService(deps.ctx, deps.ocr).processInvoice(created.invoiceId, actor);
          status = outcome.status;
        } catch {
          // OCR не удался → накладная уже в draft+ocrError (markOcrFailed); upload успешен.
          status = (await deps.ctx.repositories.invoices.getById(created.invoiceId))?.status ?? 'draft';
        }
      }
      res.status(200).json({ success: true, invoiceId: created.invoiceId, status });
    },
  );

  // Ручной re-OCR — ТОЛЬКО admin (legacy: manual re-OCR admin-only; initial OCR идёт через upload).
  // Синхронно (MVP): без IIFE/queue/worker/waitUntil.
  router.post('/:id/ocr', auth, admin, async (req, res) => {
    const ocrDeps = deps.ocr;
    if (!ocrDeps) throw new Error('OCR-зависимости не сконфигурированы'); // → 500 (config)
    const result = await new OcrService(deps.ctx, ocrDeps).processInvoice(idParam(req), actorOf(req));
    res.status(200).json(result);
  });

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
