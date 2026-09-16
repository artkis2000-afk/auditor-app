import type { InvoiceItem } from '../../shared/index.js';
import type { AnomalyContext, AnomalyDataset, AnomalyFlagDraft, AnomalyRule, PriorItem } from './types.js';
import { defaultRules } from './rules/index.js';

/**
 * Движок аномалий. Чистая логика над снимком данных (без Firestore/HTTP).
 * detectInvoiceAnomalies воспроизводит поведение исходного detectInvoiceDetector 1:1,
 * но раскладывает проверки на независимые правила (rules/*).
 */

/**
 * Предыдущие покупки номенклатуры — дословный перенос getPreviousItems из исходника:
 * накладные в статусе confirmed/flagged, не текущая, с датой ≤ текущей, отсортированы по убыванию;
 * из них позиции с matchedNomenclatureId === nomenclatureId.
 */
export function getPreviousItems(
  dataset: AnomalyDataset,
  nomenclatureId: string,
  currentInvoiceId: string,
  invoiceDate: Date,
): PriorItem[] {
  const prevItems: PriorItem[] = [];

  const sortedInvoices = [...dataset.invoices]
    .filter((i) => i.status === 'confirmed' || i.status === 'flagged')
    .filter((i) => i.id !== currentInvoiceId)
    .filter((i) => new Date(i.recognizedDate) <= invoiceDate)
    .sort((a, b) => new Date(b.recognizedDate).getTime() - new Date(a.recognizedDate).getTime());

  for (const inv of sortedInvoices) {
    const items = dataset.invoiceItems.filter(
      (ii) => ii.invoiceId === inv.id && ii.matchedNomenclatureId === nomenclatureId,
    );
    for (const it of items) {
      prevItems.push({ item: it, invoice: inv });
    }
  }

  return prevItems;
}

export interface DetectionResult {
  flags: AnomalyFlagDraft[];
  invoiceStatus: 'confirmed' | 'flagged';
}

/**
 * Детект аномалий для одной накладной. Перенос detectInvoiceAnomalies из исходника.
 * @param items позиции накладной (updatedItems в оригинале)
 */
export function detectInvoiceAnomalies(
  invoiceId: string,
  items: InvoiceItem[],
  dataset: AnomalyDataset,
  rules: AnomalyRule[] = defaultRules,
): DetectionResult {
  const invoice = dataset.invoices.find((i) => i.id === invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const invoiceDate = new Date(invoice.recognizedDate);
  const supplierName = invoice.supplierName || invoice.rawSupplierName || 'Неизвестный поставщик';
  const activeNomenclatures = dataset.nomenclatures.filter((n) => !n.deletedAt);

  const flags: AnomalyFlagDraft[] = [];

  for (const item of items) {
    const nomenclatureId = item.matchedNomenclatureId;
    if (!nomenclatureId) continue; // нет привязки — пропускаем глубокие проверки

    const nomenclature = activeNomenclatures.find((n) => n.id === nomenclatureId);
    if (!nomenclature) continue;

    const priorItems = getPreviousItems(dataset, nomenclatureId, invoiceId, invoiceDate);

    const ctx: AnomalyContext = {
      invoice,
      invoiceDate,
      supplierName,
      nomenclature,
      settings: dataset.settings,
      priorItems,
      vehicles: dataset.vehicles,
    };

    for (const rule of rules) {
      flags.push(...rule.evaluate(item, ctx));
    }
  }

  const invoiceStatus: 'confirmed' | 'flagged' = flags.length > 0 ? 'flagged' : 'confirmed';
  return { flags, invoiceStatus };
}
