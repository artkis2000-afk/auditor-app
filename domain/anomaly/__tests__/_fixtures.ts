import type {
  AnomalyFlag,
  Invoice,
  InvoiceItem,
  Nomenclature,
  Vehicle,
} from '../../../shared/index.js';
import type { AnomalyDataset, AnomalySettings } from '../types.js';
import { recalculateGlobal, type RecalcOptions } from '../recalculation/recalculationService.js';

/** Детерминированные опции пересчёта для тестов (стабильные id/createdAt). */
export const detOpts: RecalcOptions = {
  generateId: (invoiceId, index) => `af-${invoiceId}-${index}`,
  now: () => '2026-09-17T00:00:00.000Z',
};

export function inv(partial: Partial<Invoice> & { id: string; recognizedDate: string }): Invoice {
  return {
    imagePath: '',
    status: 'confirmed',
    uploadedBy: 'u-admin',
    supplierId: null,
    supplierName: null,
    rawSupplierName: null,
    totalSum: 0,
    isReconciled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

export function item(
  partial: Partial<InvoiceItem> & { id: string; invoiceId: string; unitPrice: number },
): InvoiceItem {
  return {
    nomenclatureId: null,
    rawName: '',
    quantity: 1,
    lineSum: partial.lineSum ?? partial.unitPrice,
    matchedNomenclatureId: null,
    ...partial,
  };
}

export function nom(
  partial: Partial<Nomenclature> & { id: string; normalizedName: string },
): Nomenclature {
  return {
    category: 'Тест',
    normativeServiceDays: 0,
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

export const testVehicles: Vehicle[] = [
  { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67', designation: 'V569' },
  { id: 'v-scania', name: 'Вольво 563', plate: 'О 563 РВ 31', designation: 'V563' },
];

export function dataset(
  invoices: Invoice[],
  invoiceItems: InvoiceItem[],
  nomenclatures: Nomenclature[],
  settings?: Partial<AnomalySettings>,
  vehicles: Vehicle[] = testVehicles,
): AnomalyDataset {
  return {
    invoices,
    invoiceItems,
    nomenclatures,
    settings: { anomalyThreshold: 10, duplicateDays: 180, ...settings },
    vehicles,
  };
}

/** Нормализация флага для сравнения (без нестабильных id/createdAt). */
export function normFlag(f: AnomalyFlag) {
  return {
    invoiceId: f.invoiceId,
    invoiceItemId: f.invoiceItemId,
    relatedInvoiceId: f.relatedInvoiceId ?? null,
    flagType: f.flagType,
    severity: f.severity,
    details: f.details,
    isResolved: f.isResolved,
    resolvedBy: f.resolvedBy,
    resolvedAt: f.resolvedAt,
  };
}

export function normFlags(flags: AnomalyFlag[]) {
  return flags.map(normFlag).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function statusesToObj(statuses: Map<string, string>): Record<string, string> {
  return Object.fromEntries([...statuses.entries()].sort());
}

/**
 * Делает статусы накладных согласованными с текущими данными:
 * прогоняет global-пересчёт и применяет полученные статусы к dataset.
 * Возвращает согласованный набор существующих флагов (база для инкрементальных сценариев).
 */
export function makeConsistent(ds: AnomalyDataset): AnomalyFlag[] {
  const { flags, statuses } = recalculateGlobal(ds, [], detOpts);
  for (const invoice of ds.invoices) {
    const s = statuses.get(invoice.id);
    if (s) invoice.status = s;
  }
  return flags;
}
