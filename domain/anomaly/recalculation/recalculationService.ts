import type { AnomalyFlag } from '../../../shared/index.js';
import type { AnomalyDataset, AnomalyFlagDraft } from '../types.js';
import { detectInvoiceAnomalies } from '../anomalyEngine.js';
import { computeScope, expandScope, type AnomalyChange, type RecalcScope } from './dependencyModel.js';

/**
 * Сервис пересчёта аномалий (чистый, без Firestore).
 * - recalculateGlobal — авторитетный полный пересчёт, дословно повторяет
 *   recalculateAllInvoiceAnomalies из исходника (порядок flags/статусов, сохранение resolved).
 * - recalculate — инкрементальный: по AnomalyChange выбирает scope (local/chain/global)
 *   и пересчитывает только затронутые накладные, остальные флаги/статусы сохраняет.
 *
 * Ключ восстановления resolved-состояния: `invoiceId | invoiceItemId | flagType` (как в оригинале).
 */

export type InvoiceStatus = 'confirmed' | 'flagged';

export interface RecalcResult {
  flags: AnomalyFlag[];
  statuses: Map<string, InvoiceStatus>;
}

export interface RecalcOptions {
  /** Генератор id флага (инъекция для детерминизма в тестах). */
  generateId?: (invoiceId: string, index: number) => string;
  /** Источник времени (инъекция для детерминизма в тестах). */
  now?: () => string;
}

function resolvedKey(invoiceId: string, invoiceItemId: string | null | undefined, flagType: string): string {
  return `${invoiceId}-${invoiceItemId || 'none'}-${flagType}`;
}

function buildResolvedMap(existingFlags: AnomalyFlag[]): Map<string, { resolvedBy: string | null; resolvedAt: string | null }> {
  const map = new Map<string, { resolvedBy: string | null; resolvedAt: string | null }>();
  for (const f of existingFlags) {
    if (f.isResolved) {
      map.set(resolvedKey(f.invoiceId, f.invoiceItemId, f.flagType), {
        resolvedBy: f.resolvedBy,
        resolvedAt: f.resolvedAt,
      });
    }
  }
  return map;
}

const defaultGenerateId = (invoiceId: string, index: number): string =>
  `af-${invoiceId}-${index}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

/** Пересчёт одной накладной с восстановлением resolved-состояния и вычислением статуса. */
function computeInvoice(
  dataset: AnomalyDataset,
  invoice: AnomalyDataset['invoices'][number],
  resolvedMap: Map<string, { resolvedBy: string | null; resolvedAt: string | null }>,
  genId: (invoiceId: string, index: number) => string,
  now: () => string,
): { flags: AnomalyFlag[]; status: InvoiceStatus } {
  const items = dataset.invoiceItems.filter((ii) => ii.invoiceId === invoice.id);

  let drafts: AnomalyFlagDraft[] = [];
  try {
    drafts = detectInvoiceAnomalies(invoice.id, items, dataset).flags;
  } catch {
    // Как в оригинале: ошибка детекта логируется и пропускается; накладная остаётся без флагов
    drafts = [];
  }

  const flags: AnomalyFlag[] = drafts.map((fl, idx) => {
    const key = resolvedKey(invoice.id, fl.invoiceItemId, fl.flagType);
    const prevResolved = resolvedMap.get(key);
    const isResolved = !!invoice.isReconciled || !!prevResolved;
    return {
      ...fl,
      id: genId(invoice.id, idx),
      isResolved,
      resolvedBy: invoice.isReconciled ? prevResolved?.resolvedBy ?? 'Сверено' : prevResolved ? prevResolved.resolvedBy : null,
      resolvedAt: invoice.isReconciled ? prevResolved?.resolvedAt ?? now() : prevResolved ? prevResolved.resolvedAt : null,
      createdAt: now(),
    };
  });

  let status: InvoiceStatus;
  if (invoice.isReconciled) {
    status = 'confirmed';
  } else {
    status = flags.some((f) => !f.isResolved) ? 'flagged' : 'confirmed';
  }

  return { flags, status };
}

/** Пересчитывает указанное множество накладных; для остальных сохраняет существующие флаги/статус. */
function recomputeInvoices(
  dataset: AnomalyDataset,
  existingFlags: AnomalyFlag[],
  targetIds: Set<string>,
  opts: RecalcOptions = {},
): RecalcResult {
  const genId = opts.generateId ?? defaultGenerateId;
  const now = opts.now ?? (() => new Date().toISOString());
  const resolvedMap = buildResolvedMap(existingFlags);

  const flags: AnomalyFlag[] = [];
  const statuses = new Map<string, InvoiceStatus>();

  const activeInvoices = dataset.invoices.filter(
    (i) => !i.deletedAt && (i.status === 'confirmed' || i.status === 'flagged'),
  );

  for (const invoice of activeInvoices) {
    if (targetIds.has(invoice.id)) {
      const { flags: f, status } = computeInvoice(dataset, invoice, resolvedMap, genId, now);
      flags.push(...f);
      statuses.set(invoice.id, status);
    } else {
      // Вне scope — сохраняем существующие флаги и текущий статус
      for (const ef of existingFlags) {
        if (ef.invoiceId === invoice.id) flags.push(ef);
      }
      statuses.set(invoice.id, invoice.status === 'flagged' ? 'flagged' : 'confirmed');
    }
  }

  return { flags, statuses };
}

/** Авторитетный полный пересчёт (== recalculateAllInvoiceAnomalies оригинала). */
export function recalculateGlobal(
  dataset: AnomalyDataset,
  existingFlags: AnomalyFlag[],
  opts: RecalcOptions = {},
): RecalcResult {
  const allIds = new Set(
    dataset.invoices
      .filter((i) => !i.deletedAt && (i.status === 'confirmed' || i.status === 'flagged'))
      .map((i) => i.id),
  );
  return recomputeInvoices(dataset, existingFlags, allIds, opts);
}

export interface ScopedRecalcResult extends RecalcResult {
  scope: RecalcScope;
  recomputedInvoiceIds: string[];
}

/** Инкрементальный пересчёт по описанию изменения. */
export function recalculate(
  dataset: AnomalyDataset,
  existingFlags: AnomalyFlag[],
  change: AnomalyChange,
  opts: RecalcOptions = {},
): ScopedRecalcResult {
  const scope = computeScope(change, dataset);
  const targetIds = expandScope(scope, dataset);
  const result = recomputeInvoices(dataset, existingFlags, targetIds, opts);
  return { ...result, scope, recomputedInvoiceIds: [...targetIds] };
}
