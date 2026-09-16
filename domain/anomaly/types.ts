import type { AnomalyFlag, Invoice, InvoiceItem, Nomenclature, Vehicle } from '../../shared/index.js';

/** Черновик флага (без id/createdAt) — как Omit в исходном detectInvoiceAnomalies. */
export type AnomalyFlagDraft = Omit<AnomalyFlag, 'id' | 'createdAt'>;

/** Предыдущая покупка той же номенклатуры (позиция + её накладная). */
export interface PriorItem {
  item: InvoiceItem;
  invoice: Invoice;
}

/**
 * Настройки, влияющие на детект.
 * ВНИМАНИЕ (как в оригинале): duplicateDays в правилах НЕ используется — окно дубликатов
 * берётся из nomenclature.normativeServiceDays. Поле сохранено для совместимости.
 */
export interface AnomalySettings {
  anomalyThreshold: number;
  duplicateDays: number;
}

/** Контекст для правила: движок готовит его один раз на позицию. Правила — чистые. */
export interface AnomalyContext {
  invoice: Invoice;
  invoiceDate: Date;
  supplierName: string;
  nomenclature: Nomenclature;
  settings: AnomalySettings;
  /** Предыдущие покупки этой номенклатуры (confirmed/flagged, дата ≤ текущей, кроме себя), отсортированы по убыванию даты. */
  priorItems: PriorItem[];
  vehicles: Vehicle[];
}

/** Правило аномалии. Новое правило = новый файл, реализующий этот интерфейс + регистрация в движке. */
export interface AnomalyRule {
  readonly type: AnomalyFlag['flagType'];
  evaluate(item: InvoiceItem, ctx: AnomalyContext): AnomalyFlagDraft[];
}

/** Полный снимок данных, над которым работает движок (чистые массивы, без Firestore). */
export interface AnomalyDataset {
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  nomenclatures: Nomenclature[];
  settings: AnomalySettings;
  vehicles: Vehicle[];
}
