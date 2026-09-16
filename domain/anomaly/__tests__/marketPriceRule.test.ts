import { describe, it, expect } from 'vitest';
import { detectInvoiceAnomalies } from '../anomalyEngine.js';
import { inv, item, nom, dataset } from './_fixtures.js';

// Изоляция: normativeServiceDays=0 (нет дубликатов), разные поставщики (нет supplier-правила).
const N0 = [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 0 })];

describe('marketPriceRule (через detectInvoiceAnomalies)', () => {
  it('положительный: +20% к средней за 90 дней → low/price_anomaly', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-05-01', supplierName: 'ООО A' }),
      inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО B' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 1200 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N0));
    expect(res.flags).toHaveLength(1);
    const f = res.flags[0]!;
    expect(f.flagType).toBe('price_anomaly');
    expect(f.severity).toBe('low');
    expect(f.relatedInvoiceId).toBe('P');
    expect(f.details).toContain('среднюю рыночную');
    expect(f.details).toContain('20.0%');
  });

  it('граница окна: ровно 90 дней включается; 91 день исключается', () => {
    const mk = (prevDate: string) => {
      const invoices = [
        inv({ id: 'P', recognizedDate: prevDate, supplierName: 'ООО A' }),
        inv({ id: 'C', recognizedDate: '2026-04-01', supplierName: 'ООО B' }),
      ];
      const items = [
        item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
        item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 1200 }),
      ];
      return detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N0));
    };
    expect(mk('2026-01-01').flags).toHaveLength(1); // ровно 90 дней до 2026-04-01
    expect(mk('2025-12-31').flags).toHaveLength(0); // 91 день
  });

  it('нет аномалии: +5%', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-05-01', supplierName: 'ООО A' }),
      inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО B' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 1050 }),
    ];
    expect(detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N0)).flags).toHaveLength(0);
  });

  it('среднее по нескольким prior', () => {
    const invoices = [
      inv({ id: 'P1', recognizedDate: '2026-05-01', supplierName: 'ООО A' }),
      inv({ id: 'P2', recognizedDate: '2026-05-15', supplierName: 'ООО C' }),
      inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО B' }),
    ];
    const items = [
      item({ id: 'p1', invoiceId: 'P1', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
      item({ id: 'p2', invoiceId: 'P2', matchedNomenclatureId: 'N1', unitPrice: 2000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 3000 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[2]!], dataset(invoices, items, N0));
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]!.details).toContain('1500 руб'); // среднее (1000+2000)/2
    expect(res.flags[0]!.details).toContain('100.0%');
  });

  it('нет предыдущих покупок → нет флага', () => {
    const invoices = [inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО B' })];
    const items = [item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 9999 })];
    expect(detectInvoiceAnomalies('C', [items[0]!], dataset(invoices, items, N0)).flags).toHaveLength(0);
  });
});
