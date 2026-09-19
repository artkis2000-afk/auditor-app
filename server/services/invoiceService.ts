import type { AnomalyFlag, Invoice, InvoiceItem } from '../../shared/index.js';
import type {
  ManualInvoiceRequest,
  InvoiceUpdateRequest,
  InvoiceUploadRequest,
  ApproveFlagRequest,
  InvoiceListEntry,
  InvoiceDetail,
} from '../../shared/index.js';
import { findBestNomenclatureMatches } from '../../domain/matching/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import { type ImageStore, buildInvoiceImageKey } from '../storage/index.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { AuditService } from './auditService.js';
import { RECONCILED_PIN, buildInvoiceItems, ensureSupplier } from './invoiceHelpers.js';
import { extractImageData } from './ocrHelpers.js';

/** Действующий пользователь (для аудита и правил доступа). Роль-доступ — на слое routes. */
export interface Actor {
  id: string;
  username: string;
  role?: string;
}

export type InvoiceErrorCode = 'NOT_FOUND' | 'PIN_REQUIRED' | 'PAYLOAD_TOO_LARGE';

/**
 * Максимальный размер декодированного изображения. Держим ниже лимита тела Vercel-функции
 * (4.5 MB на весь запрос; base64 ≈ +33%), чтобы клиент получил понятный 413, а не generic-фейл.
 */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Разбирает upload-вход: определяет MIME и байты; поддерживает data-URL и «сырой» base64. */
function decodeUpload(input: InvoiceUploadRequest): { bytes: Buffer; contentType: string } {
  const raw = input.base64;
  let b64 = raw;
  let mime = input.type;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    const header = comma >= 0 ? raw.slice(5, comma) : '';
    const headerMime = header.split(';')[0];
    if (!mime && headerMime) mime = headerMime;
    b64 = comma >= 0 ? raw.slice(comma + 1) : '';
  }
  const normalized = mime?.toLowerCase().split(';')[0]?.trim();
  const contentType = normalized && ALLOWED_IMAGE_MIME.has(normalized) ? normalized : 'image/jpeg';
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new InvoiceServiceError(
      'PAYLOAD_TOO_LARGE',
      `Изображение слишком большое (> ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} МБ). Сожмите файл и загрузите снова.`,
    );
  }
  return { bytes, contentType };
}

export class InvoiceServiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceServiceError';
  }
}

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/**
 * Бизнес-операции над накладными. Перенос обработчиков server.ts.
 * Пересчёт аномалий — через AnomalyService.recalculateAll (полная совместимость с оригиналом).
 * Запись — атомарным commitBatch; в одном батче каждый документ затрагивается не более одного раза.
 */
export class InvoiceService {
  private readonly anomaly: AnomalyService;
  private readonly audit: AuditService;

  constructor(private readonly ctx: ServiceContext) {
    this.anomaly = new AnomalyService(ctx);
    this.audit = new AuditService(ctx);
  }

  /** Ручное создание накладной. */
  async createManual(input: ManualInvoiceRequest, actor: Actor): Promise<{ invoiceId: string; status: string }> {
    const now = this.ctx.clock.now();
    const invoiceId = this.ctx.ids.generate('inv');

    const suppliers = await this.ctx.repositories.suppliers.getAll();
    const { supplierId, created } = ensureSupplier(suppliers, input.supplierName, actor.id, this.ctx.ids, now);
    const { items, totalSum } = buildInvoiceItems(input.items, invoiceId, this.ctx.ids);

    const invoice: Invoice = {
      id: invoiceId,
      imagePath: '',
      recognizedDate: input.recognizedDate || now.split('T')[0]!,
      status: 'confirmed', // предварительный; финальный статус задаст recalculateAll
      uploadedBy: actor.id,
      supplierId,
      supplierName: input.supplierName || 'Не указан',
      rawSupplierName: null,
      totalSum,
      filename: 'Создана вручную',
      comment: input.comment || '',
      isReconciled: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const ops: BatchOp[] = [];
    if (created) ops.push({ type: 'set', collection: 'suppliers', id: created.id, data: asDoc(created) });
    ops.push({ type: 'set', collection: 'invoices', id: invoiceId, data: asDoc(invoice) });
    for (const it of items) ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    const finalStatus = (await this.ctx.repositories.invoices.getById(invoiceId))?.status ?? 'confirmed';
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_manual_create',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: null,
      newValues: { status: finalStatus, itemsCount: items.length },
    });

    return { invoiceId, status: finalStatus };
  }

  /**
   * Загрузка накладной изображением: оригинал → ImageStore, накладная в статусе 'processing'
   * с imagePath = storage key (без base64 в Firestore). OCR НЕ запускается здесь.
   * Compensation: если put успешен, а запись в Firestore упала — пытаемся удалить объект
   * (сбой удаления не маскирует исходную ошибку). Возврат — legacy-совместимый.
   */
  async createFromUpload(
    input: InvoiceUploadRequest,
    actor: Actor,
    imageStore: ImageStore,
  ): Promise<{ invoiceId: string; status: string }> {
    const now = this.ctx.clock.now();
    const invoiceId = this.ctx.ids.generate('inv');
    const { bytes, contentType } = decodeUpload(input);
    const storageKey = buildInvoiceImageKey(invoiceId, contentType);

    await imageStore.put(storageKey, bytes, contentType);

    const invoice: Invoice = {
      id: invoiceId,
      imagePath: storageKey, // ссылка на объект хранилища, НЕ base64
      recognizedDate: now.split('T')[0]!,
      status: 'processing',
      uploadedBy: actor.id,
      supplierId: null,
      supplierName: null,
      rawSupplierName: null,
      totalSum: 0,
      filename: input.name ?? null,
      comment: null,
      isReconciled: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    try {
      await this.ctx.gateway.set('invoices', invoiceId, asDoc(invoice));
    } catch (err) {
      try {
        await imageStore.delete(storageKey); // compensation
      } catch {
        // сбой удаления не маскируем — пробрасываем исходную ошибку записи
      }
      throw err;
    }

    return { invoiceId, status: 'processing' };
  }

  /**
   * Байты оригинала накладной для отдачи клиенту (GET /:id/image).
   * Storage key → ImageStore; legacy data-URL → инлайн; пусто/плейсхолдер → NOT_FOUND.
   */
  async getImage(id: string, imageStore: ImageStore): Promise<{ data: Buffer; contentType: string }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');
    const src = invoice.imagePath;
    if (!src || src === '/assets/invoice_placeholder.png') {
      throw new InvoiceServiceError('NOT_FOUND', 'Изображение накладной отсутствует');
    }
    if (src.startsWith('data:')) {
      const { base64, mimeType } = extractImageData(src);
      return { data: Buffer.from(base64, 'base64'), contentType: mimeType };
    }
    return imageStore.get(src);
  }

  /** Редактирование накладной. */
  async edit(
    id: string,
    input: InvoiceUpdateRequest,
    actor: Actor,
  ): Promise<{ totalSum: number; status: string; flagsCount: number; flags: AnomalyFlag[] }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');
    if (invoice.isReconciled && String(input.pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'Накладная сверена и заблокирована. Требуется PIN-код.');
    }

    const oldItems = await this.ctx.repositories.invoiceItems.listByInvoice(id);
    const suppliers = await this.ctx.repositories.suppliers.getAll();
    const now = this.ctx.clock.now();
    const { supplierId, created } = ensureSupplier(suppliers, input.supplierName, actor.id, this.ctx.ids, now);
    const { items, totalSum } = buildInvoiceItems(input.items, id, this.ctx.ids);

    const updated: Invoice = {
      ...invoice,
      recognizedDate: input.recognizedDate,
      supplierName: input.supplierName,
      supplierId,
      comment: input.comment !== undefined ? input.comment : invoice.comment,
      totalSum,
      updatedAt: now,
    };

    const newIds = new Set(items.map((i) => i.id));
    const ops: BatchOp[] = [];
    if (created) ops.push({ type: 'set', collection: 'suppliers', id: created.id, data: asDoc(created) });
    for (const oi of oldItems) if (!newIds.has(oi.id)) ops.push({ type: 'delete', collection: 'invoiceItems', id: oi.id });
    for (const it of items) ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    ops.push({ type: 'set', collection: 'invoices', id, data: asDoc(updated) });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    const finalInvoice = await this.ctx.repositories.invoices.getById(id);
    const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
    const status = finalInvoice?.status ?? invoice.status;

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_edit',
      entityType: 'invoice',
      entityId: id,
      oldValues: { ...invoice, items: oldItems },
      newValues: {
        recognizedDate: input.recognizedDate,
        supplierName: input.supplierName,
        totalSum,
        itemsCount: items.length,
        status,
        flagsCount: flags.length,
      },
    });

    return { totalSum, status, flagsCount: flags.length, flags };
  }

  /** Подтверждение накладной. */
  async confirm(id: string, actor: Actor): Promise<{ status: string; flagsCount: number; flags: AnomalyFlag[] }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');

    const oldStatus = invoice.status;
    const now = this.ctx.clock.now();
    await this.ctx.gateway.commitBatch([
      { type: 'set', collection: 'invoices', id, data: asDoc({ ...invoice, status: 'confirmed', updatedAt: now }) },
    ]);

    await this.anomaly.recalculateAll();

    const finalInvoice = await this.ctx.repositories.invoices.getById(id);
    const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
    const status = finalInvoice?.status ?? 'confirmed';

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_confirm',
      entityType: 'invoice',
      entityId: id,
      oldValues: { status: oldStatus },
      newValues: { status, flagsCount: flags.length },
    });

    return { status, flagsCount: flags.length, flags };
  }

  /** Мягкое удаление накладной (позиции удаляются жёстко — legacy, KI-8). */
  async delete(id: string, actor: Actor, pin?: string): Promise<{ success: true }> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');
    if (invoice.isReconciled && String(pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'Накладная сверена и заблокирована. Требуется PIN-код.');
    }

    const oldItems = await this.ctx.repositories.invoiceItems.listByInvoice(id);
    const now = this.ctx.clock.now();

    const ops: BatchOp[] = [{ type: 'set', collection: 'invoices', id, data: asDoc({ ...invoice, deletedAt: now }) }];
    for (const oi of oldItems) ops.push({ type: 'delete', collection: 'invoiceItems', id: oi.id });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_delete',
      entityType: 'invoice',
      entityId: id,
      oldValues: { deletedAt: null, items: oldItems },
      newValues: { deletedAt: now },
    });

    return { success: true };
  }

  /**
   * Массовое мягкое удаление.
   * ОТЛИЧИЕ ОТ LEGACY (KI-4): проверяется isReconciled + PIN, как в одиночном delete.
   * Если в пакете есть сверенная накладная и PIN неверный — операция отклоняется целиком.
   */
  async bulkDelete(ids: string[], actor: Actor, pin?: string): Promise<{ deletedCount: number }> {
    const now = this.ctx.clock.now();
    const targets: { invoice: Invoice; items: InvoiceItem[] }[] = [];

    for (const id of ids) {
      const invoice = await this.ctx.repositories.invoices.getById(id);
      if (!invoice || invoice.deletedAt) continue;
      const items = await this.ctx.repositories.invoiceItems.listByInvoice(id);
      targets.push({ invoice, items });
    }

    // KI-4: блокируем всю операцию, если есть сверенная накладная без верного PIN
    if (targets.some((t) => t.invoice.isReconciled) && String(pin) !== RECONCILED_PIN) {
      throw new InvoiceServiceError('PIN_REQUIRED', 'В пакете есть сверенные накладные. Требуется PIN-код.');
    }

    const ops: BatchOp[] = [];
    for (const { invoice, items } of targets) {
      ops.push({ type: 'set', collection: 'invoices', id: invoice.id, data: asDoc({ ...invoice, deletedAt: now }) });
      for (const it of items) ops.push({ type: 'delete', collection: 'invoiceItems', id: it.id });
    }

    if (ops.length > 0) {
      await this.ctx.gateway.commitBatch(ops);
      await this.anomaly.recalculateAll();
      for (const { invoice, items } of targets) {
        await this.audit.log({
          userId: actor.id,
          username: actor.username,
          action: 'invoice_delete',
          entityType: 'invoice',
          entityId: invoice.id,
          oldValues: { deletedAt: null, items },
          newValues: { deletedAt: now },
        });
      }
    }

    return { deletedCount: targets.length };
  }

  /** Массовая сверка (СВЕРЕНО): блокирует накладную, помечает её флаги resolved. */
  async reconcile(ids: string[], actor: Actor): Promise<{ reconciledCount: number }> {
    const now = this.ctx.clock.now();
    const resolvedBy = actor.username || 'Сверено';
    const reconciled: Invoice[] = [];
    const ops: BatchOp[] = [];

    for (const id of ids) {
      const invoice = await this.ctx.repositories.invoices.getById(id);
      if (!invoice || invoice.deletedAt) continue;

      reconciled.push(invoice);
      ops.push({
        type: 'set',
        collection: 'invoices',
        id,
        data: asDoc({ ...invoice, isReconciled: true, status: 'confirmed', updatedAt: now }),
      });

      // Пометить существующие флаги resolved с resolvedBy=username (перенос legacy);
      // recalculateAll сохранит resolvedBy через resolvedMap.
      const flags = await this.ctx.repositories.anomalyFlags.listByInvoice(id);
      for (const f of flags) {
        ops.push({
          type: 'set',
          collection: 'anomalyFlags',
          id: f.id,
          data: asDoc({ ...f, isResolved: true, resolvedBy, resolvedAt: now }),
        });
      }
    }

    if (ops.length > 0) {
      await this.ctx.gateway.commitBatch(ops);
      await this.anomaly.recalculateAll();
      for (const invoice of reconciled) {
        await this.audit.log({
          userId: actor.id,
          username: actor.username,
          action: 'invoice_reconcile',
          entityType: 'invoice',
          entityId: invoice.id,
          oldValues: { isReconciled: false },
          newValues: { isReconciled: true, status: 'confirmed' },
        });
      }
    }

    return { reconciledCount: reconciled.length };
  }

  /** Список накладных с бизнес-данными (перенос GET /api/invoices). imagePath-плейсхолдер — на routes. */
  async list(filter: { status?: string; supplierId?: string } = {}): Promise<InvoiceListEntry[]> {
    const [invoices, items, flags, users] = await Promise.all([
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.anomalyFlags.getAll(),
      this.ctx.repositories.users.getAll(),
    ]);

    let active = invoices.filter((i) => !i.deletedAt);
    if (filter.status) active = active.filter((i) => i.status === filter.status);
    if (filter.supplierId) active = active.filter((i) => i.supplierId === filter.supplierId);
    active.sort((a, b) => b.recognizedDate.localeCompare(a.recognizedDate));

    return active.map((inv) => {
      const uploader = users.find((u) => u.id === inv.uploadedBy);
      const invItems = items.filter((it) => it.invoiceId === inv.id);
      const flagsCount = inv.isReconciled ? 0 : flags.filter((f) => f.invoiceId === inv.id && !f.isResolved).length;
      const { imagePath: _imagePath, supplierName: _supplierName, ...rest } = inv;
      return {
        ...rest,
        supplierName: inv.supplierName || inv.rawSupplierName || 'Не распознан',
        uploaderName: uploader?.fullName ?? 'Неизвестно',
        flagsCount,
        items: invItems.map((it) => ({
          id: it.id,
          rawName: it.rawName,
          matchedNomenclatureId: it.matchedNomenclatureId,
          vehicleId: it.vehicleId,
          truckPlacement: it.truckPlacement,
        })),
      };
    });
  }

  /** Детальная накладная с подсказками номенклатуры (перенос GET /api/invoices/:id). */
  async getById(id: string): Promise<InvoiceDetail | null> {
    const invoice = await this.ctx.repositories.invoices.getById(id);
    if (!invoice || invoice.deletedAt) return null;

    const [items, flags, users, nomenclature, aliases] = await Promise.all([
      this.ctx.repositories.invoiceItems.listByInvoice(id),
      this.ctx.repositories.anomalyFlags.listByInvoice(id),
      this.ctx.repositories.users.getAll(),
      this.ctx.repositories.nomenclature.getAll(),
      this.ctx.repositories.nomenclatureAliases.getAll(),
    ]);

    const uploader = users.find((u) => u.id === invoice.uploadedBy);
    const itemsWithMatches = items.map((it) => ({
      ...it,
      suggestions: findBestNomenclatureMatches(it.rawName, nomenclature, aliases),
    }));

    return {
      invoice,
      items: itemsWithMatches,
      flags,
      supplierName: invoice.supplierName || invoice.rawSupplierName || 'Не распознан',
      uploaderName: uploader?.fullName ?? 'Неизвестно',
    };
  }

  /**
   * Одобрение (resolve) конкретного флага (перенос POST /api/invoices/:id/approve-flag).
   * Boss-only авторизация — на transport layer (AuthorizationService), здесь не дублируется.
   */
  async approveFlag(
    invoiceId: string,
    input: ApproveFlagRequest,
    actor: Actor,
  ): Promise<{ success: true; flag: AnomalyFlag; invoiceStatus: string }> {
    const flags = await this.ctx.repositories.anomalyFlags.getAll();
    let flag = input.flagId ? flags.find((f) => f.id === input.flagId) : undefined;
    if (!flag && input.invoiceItemId && input.flagType) {
      flag = flags.find(
        (f) => f.invoiceId === invoiceId && f.invoiceItemId === input.invoiceItemId && f.flagType === input.flagType,
      );
    }
    if (!flag) throw new InvoiceServiceError('NOT_FOUND', 'Аномалия не найдена');

    const now = this.ctx.clock.now();
    const resolved: AnomalyFlag = { ...flag, isResolved: true, resolvedBy: actor.username, resolvedAt: now };
    await this.ctx.gateway.commitBatch([{ type: 'set', collection: 'anomalyFlags', id: flag.id, data: asDoc(resolved) }]);
    await this.anomaly.recalculateAll();

    const invoiceStatus = (await this.ctx.repositories.invoices.getById(invoiceId))?.status ?? 'confirmed';
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_approve_flag',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: { flagType: flag.flagType, isResolved: false },
      newValues: { flagType: flag.flagType, isResolved: true, invoiceStatus },
    });
    return { success: true, flag: resolved, invoiceStatus };
  }

  /** Одобрение всех флагов накладной (перенос POST /api/invoices/:id/approve-all-flags). */
  async approveAllFlags(invoiceId: string, actor: Actor): Promise<{ success: true; status: string; flags: AnomalyFlag[] }> {
    const invoice = await this.ctx.repositories.invoices.getById(invoiceId);
    if (!invoice || invoice.deletedAt) throw new InvoiceServiceError('NOT_FOUND', 'Накладная не найдена');

    const now = this.ctx.clock.now();
    const invoiceFlags = (await this.ctx.repositories.anomalyFlags.getAll()).filter((f) => f.invoiceId === invoiceId);
    const ops: BatchOp[] = invoiceFlags.map((f) => ({
      type: 'set' as const,
      collection: 'anomalyFlags',
      id: f.id,
      data: asDoc({ ...f, isResolved: true, resolvedBy: actor.username, resolvedAt: now }),
    }));
    ops.push({ type: 'set', collection: 'invoices', id: invoiceId, data: asDoc({ ...invoice, status: 'confirmed', updatedAt: now }) });
    await this.ctx.gateway.commitBatch(ops);
    await this.anomaly.recalculateAll();

    const status = (await this.ctx.repositories.invoices.getById(invoiceId))?.status ?? 'confirmed';
    const flags = (await this.ctx.repositories.anomalyFlags.getAll()).filter((f) => f.invoiceId === invoiceId);
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_approve_all_flags',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: {},
      newValues: { status, approvedFlagsCount: invoiceFlags.length },
    });
    return { success: true, status, flags };
  }
}
