import type { Invoice } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import { OcrError, type ImagePreprocessor, type OcrProvider, type ParsedInvoice } from '../ai/types.js';
import type { ServiceContext } from './context.js';
import { AnomalyService } from './anomalyService.js';
import { AuditService } from './auditService.js';
import type { Actor } from './invoiceService.js';
import { ensureSupplier } from './invoiceHelpers.js';
import { buildOcrItems, extractImageData } from './ocrHelpers.js';

export interface OcrServiceDeps {
  /** Основной провайдер (Gemini в 4.6). Может отсутствовать → используется fallback. */
  primary?: OcrProvider;
  /** Резервный провайдер (детерминированный демо-OCR). */
  fallback: OcrProvider;
  preprocessor: ImagePreprocessor;
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
    if (!invoice || invoice.deletedAt) throw new OcrError('Накладная не найдена');
    if (!invoice.imagePath) {
      throw new OcrError('Изображение накладной отсутствует. Загрузите файл заново.');
    }

    const now = this.ctx.clock.now();
    const settings = await this.ctx.repositories.settings.get();
    const { base64, mimeType } = extractImageData(invoice.imagePath);
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
        const r = await this.deps.fallback.recognize(req);
        parsed = r.parsed;
        fallback = true;
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      const r = await this.deps.fallback.recognize(req);
      parsed = r.parsed;
      fallback = true;
      error = r.error ?? 'OCR-провайдер не настроен (демо-режим)';
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
      imagePath: '', // очищаем base64 после распознавания (legacy)
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
}
