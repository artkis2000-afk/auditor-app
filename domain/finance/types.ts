/**
 * Типы финансового домена. Чистые вычисления (без Firestore/HTTP/React).
 * Источник поведения: FleetFinanceView.tsx (распределение общего склада, итоги по машинам)
 * и server.ts dashboard (потенциальная экономия).
 */

/** Минимальный набор полей позиции, нужный финансовым расчётам. */
export interface FinanceItem {
  vehicleId?: string | null;
  quantity: number;
  unitPrice: number;
  lineSum?: number;
  /** Дата накладной (в исходнике — денормализованное recognizedDate на позиции). */
  recognizedDate?: string | null;
  supplierName?: string | null;
}

export type PeriodType = 'all' | 'year' | 'quarter' | 'month' | 'custom';

export interface PeriodFilter {
  periodType: PeriodType;
  selectedYear: number;
  selectedQuarter: number;
  selectedMonth: number;
  startDate?: string;
  endDate?: string;
}

/** Запись исключения машины из распределения общего склада за конкретный месяц. */
export interface ExclusionEntry {
  vehicleId: string;
  year: number;
  month: number;
}
