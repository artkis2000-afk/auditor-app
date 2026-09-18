import type { Invoice } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import { OcrError, type ImagePreprocessor, type OcrProvider, type ParsedInvoice } from '../ai/types.js';
import type { ImageStore } from '../storage/index.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { AuditService } from './auditService.js';
import type { Actor } from './invoiceService.js';
import { ensureSupplier } from './invoiceHelpers.js';
import { buildOcrItems, extractImageData } from './ocrHelpers.js';

/** Плейсхолдер списка/усечённого изображения — не является настоящим изображением. */
const LIST_IMAGE_PLACEHOLDER = '/assets/invoice_placeholder.png';

export interface OcrServiceDeps {
  /** Основной провайдер (Gemini). Может отсутствовать → см. политику fallback. */
  primary?: OcrProvider;
  /**
   * Резервный провайдер (детерминированный демо-OCR). ОПЦИОНАЛЕН и осознанно:
   * в production он НЕ передаётся (см. KI-22) — молчаливый fake OCR запрещён,
   * сбой Gemini уводит накладную в ошибочное состояние (draft + ocrError).
   */
  fallback?: OcrProvider;
  preprocessor: ImagePreprocessor;
  /** Хранилище оригиналов. Нужно, когда imagePath — storage key (новый формат). */
  imageStore?: ImageStore;
}

export interface OcrOutcome {
  status: string;
  itemsCount: number;
  fallback: boolean;
}

function asDoc(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/**
 * Оркестрация OCR-пайплайна (перенос runOcrAndConfirm):
 * preprocess → recognize (primary→fallback) → нормализация шапки → ensureSupplier →
 * сборка позиций (split/matching/vehicle/placement, авто-создание номенклатуры) →
 * очистка imagePath → атомарная запись → пересчёт аномалий → аудит.
 * AI за интерфейсами; реальный Firestore не вызывается в тестах (in-memory шлюз).
 */
export class OcrService {
  private readonly anomaly: AnomalyService;
  private readonly audit: AuditService;

  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: OcrServiceDeps,
  ) {
    this.anomaly = new AnomalyService(ctx);
    this.audit = new AuditService(ctx);
  }

  async processInvoice(invoiceId: string, actor: Actor): Promise<OcrOutcome> {
    const invoice = await this.ctx.repositories.invoices.getById(invoiceId);
    if (!invoice || invoice.deletedAt) throw new OcrError('Накладная не найдена', 'NOT_FOUND');

    const now = this.ctx.clock.now();
    const { base64, mimeType, isStorageKey } = await this.loadImage(invoice);
    const settings = await this.ctx.repositories.settings.get();
    const pre = await this.deps.preprocessor.preprocess(base64, mimeType);
    const req = { base64: pre.base64, mimeType: pre.mimeType, engine: settings.aiOcrEngine };

    let parsed: ParsedInvoice;
    let fallback = false;
    let error: string | undefined;

    if (this.deps.primary) {
      try {
        const r = await this.deps.primary.recognize(req);
        parsed = r.parsed;
        fallback = r.fallback;
        error = r.error;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.deps.fallback) {
          // production: молчаливый fake OCR запрещён — фиксируем ошибку, накладную не «распознаём»
          await this.markOcrFailed(invoice, msg, now);
          throw new OcrError(`Не удалось распознать накладную: ${msg}`, 'PROVIDER');
        }
        const r = await this.deps.fallback.recognize(req);
        parsed = r.parsed;
        fallback = true;
        error = msg;
      }
    } else if (this.deps.fallback) {
      const r = await this.deps.fallback.recognize(req);
      parsed = r.parsed;
      fallback = true;
      error = r.error ?? 'OCR-провайдер не настроен (демо-режим)';
    } else {
      await this.markOcrFailed(invoice, 'OCR-провайдер не настроен', now);
      throw new OcrError('OCR-провайдер не настроен', 'PROVIDER');
    }

    const suppliers = await this.ctx.repositories.suppliers.getAll();
    const { supplierId, created: createdSupplier } = ensureSupplier(
      suppliers,
      parsed.supplierName,
      actor.id,
      this.ctx.ids,
      now,
    );

    const existingNomenclature = await this.ctx.repositories.nomenclature.getAll();
    const aliases = await this.ctx.repositories.nomenclatureAliases.getAll();
    const { items, createdNomenclatures } = buildOcrItems(
      parsed,
      invoiceId,
      invoice.filename ?? null,
      existingNomenclature,
      aliases,
      this.ctx.ids,
      now,
    );

    const updatedInvoice: Invoice = {
      ...invoice,
      recognizedDate: parsed.recognizedDate || now.split('T')[0]!,
      totalSum: parsed.totalSum || 0,
      rawSupplierName: parsed.supplierName,
      supplierName: parsed.supplierName,
      supplierId,
      ocrFallback: fallback,
      ocrError: error,
      // storage key сохраняем (нужен для повторного OCR); legacy inline base64 очищаем — новых не создаём
      imagePath: isStorageKey ? invoice.imagePath : '',
      status: 'confirmed', // предварительный; финальный статус задаст recalculateAll
      updatedAt: now,
    };

    const oldItems = await this.ctx.repositories.invoiceItems.listByInvoice(invoiceId);
    const newIds = new Set(items.map((i) => i.id));

    const ops: BatchOp[] = [];
    if (createdSupplier) ops.push({ type: 'set', collection: 'suppliers', id: createdSupplier.id, data: asDoc(createdSupplier) });
    for (const n of createdNomenclatures) ops.push({ type: 'set', collection: 'nomenclature', id: n.id, data: asDoc(n) });
    for (const oi of oldItems) if (!newIds.has(oi.id)) ops.push({ type: 'delete', collection: 'invoiceItems', id: oi.id });
    for (const it of items) ops.push({ type: 'set', collection: 'invoiceItems', id: it.id, data: asDoc(it) });
    ops.push({ type: 'set', collection: 'invoices', id: invoiceId, data: asDoc(updatedInvoice) });
    await this.ctx.gateway.commitBatch(ops);

    await this.anomaly.recalculateAll();

    const finalInvoice = await this.ctx.repositories.invoices.getById(invoiceId);
    const status = finalInvoice?.status ?? 'confirmed';

    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'invoice_ocr',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: null,
      newValues: {
        recognizedDate: updatedInvoice.recognizedDate,
        supplierName: parsed.supplierName,
        totalSum: updatedInvoice.totalSum,
        itemsCount: items.length,
        status,
      },
    });

    return { status, itemsCount: items.length, fallback };
  }

  /**
   * Достаёт байты изображения из imagePath, поддерживая совместимость форматов:
   *  - '' / плейсхолдер → изображения нет (IMAGE_MISSING);
   *  - 'data:...;base64,...' → legacy inline extraction (существующий путь);
   *  - иначе (storage key) → ImageStore.get.
   * Storage-логика живёт здесь (service), не в domain.
   */
  private async loadImage(
    invoice: Invoice,
  ): Promise<{ base64: string; mimeType: string; isStorageKey: boolean }> {
    const src = invoice.imagePath;
    if (!src || src === LIST_IMAGE_PLACEHOLDER) {
      throw new OcrError('Изображение накладной отсутствует. Загрузите файл заново.', 'IMAGE_MISSING');
    }
    if (src.startsWith('data:')) {
      const { base64, mimeType } = extractImageData(src);
      return { base64, mimeType, isStorageKey: false };
    }
    if (!this.deps.imageStore) {
      throw new OcrError('Хранилище изображений не сконфигурировано', 'STORAGE');
    }
    const stored = await this.deps.imageStore.get(src);
    return { base64: stored.data.toString('base64'), mimeType: stored.contentType, isStorageKey: true };
  }

  /**
   * Фиксирует неуспех OCR: статус → draft, ocrError установлен, ocrFallback=false,
   * позиции НЕ создаются (нет ложного confirmed). imagePath не трогаем — оригинал сохраняется
   * для повторного запуска. Одиночная запись накладной.
   */
  private async markOcrFailed(invoice: Invoice, message: string, now: string): Promise<void> {
    const failed: Invoice = {
      ...invoice,
      status: 'draft',
      ocrError: message,
      ocrFallback: false,
      updatedAt: now,
    };
    await this.ctx.gateway.set('invoices', invoice.id, asDoc(failed));
  }
}
