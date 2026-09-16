import { describe, it, expect } from 'vitest';
import { detectInvoiceAnomalies } from '../anomalyEngine.js';
import { suspiciousSupplierRule } from '../rules/index.js';
import { inv, item, nom, dataset } from './_fixtures.js';

describe('anomalyEngine — статус и порядок флагов', () => {
  it('все три правила: порядок flags = [duplicate, supplier(medium), market(low)]', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-01-01', supplierName: 'ООО Тест' }),
      inv({ id: 'C', recognizedDate: '2026-02-01', supplierName: 'ООО Тест' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1500 }),
    ];
    const ds = dataset(invoices, items, [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 180 })]);
    const res = detectInvoiceAnomalies('C', [items[1]!], ds);
    expect(res.flags.map((f) => f.flagType)).toEqual(['duplicate_exceed', 'price_anomaly', 'price_anomaly']);
    expect(res.flags.map((f) => f.severity)).toEqual(['high', 'medium', 'low']);
    expect(res.flags.some((f) => f.flagType === 'suspicious_supplier')).toBe(false);
    expect(res.invoiceStatus).toBe('flagged');
  });

  it('нет флагов → confirmed', () => {
    const invoices = [inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 1000 })];
    const ds = dataset(invoices, items, [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 0 })]);
    const res = detectInvoiceAnomalies('C', [items[0]!], ds);
    expect(res.flags).toHaveLength(0);
    expect(res.invoiceStatus).toBe('confirmed');
  });

  it('позиция без matchedNomenclatureId пропускается', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-01-01' }),
      inv({ id: 'C', recognizedDate: '2026-02-01' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: null, vehicleId: 'v-volvo', unitPrice: 5000 }),
    ];
    const ds = dataset(invoices, items, [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 180 })]);
    expect(detectInvoiceAnomalies('C', [items[1]!], ds).flags).toHaveLength(0);
  });

  it('удалённая номенклатура (deletedAt) пропускается', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-01-01' }),
      inv({ id: 'C', recognizedDate: '2026-02-01' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const ds = dataset(invoices, items, [
      nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 180, deletedAt: '2026-01-15T00:00:00Z' }),
    ]);
    expect(detectInvoiceAnomalies('C', [items[1]!], ds).flags).toHaveLength(0);
  });
});

describe('suspiciousSupplierRule — слот без логики (KI-1)', () => {
  it('всегда возвращает []', () => {
    expect(suspiciousSupplierRule.evaluate({} as never, {} as never)).toEqual([]);
    expect(suspiciousSupplierRule.type).toBe('suspicious_supplier');
  });
});
