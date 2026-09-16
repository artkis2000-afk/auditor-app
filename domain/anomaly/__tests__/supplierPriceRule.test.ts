import { describe, it, expect } from 'vitest';
import { detectInvoiceAnomalies } from '../anomalyEngine.js';
import { inv, item, nom, dataset } from './_fixtures.js';

// Изоляция: normativeServiceDays=0 (нет дубликатов), prior вне окна 90 дней (нет market-правила).
const N0 = [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 0 })];

function scenario(prevPrice: number, curPrice: number, opts?: { prevSup?: string; curSup?: string }) {
  const prevSup = opts?.prevSup ?? 'ООО Тест';
  const curSup = opts?.curSup ?? 'ООО Тест';
  const invoices = [
    inv({ id: 'P', recognizedDate: '2026-01-01', supplierName: prevSup }),
    inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: curSup }), // >90 дней позже
  ];
  const items = [
    item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', unitPrice: prevPrice }),
    item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: curPrice }),
  ];
  return detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N0));
}

describe('supplierPriceRule (через detectInvoiceAnomalies)', () => {
  it('положительный: +20% у того же поставщика → medium/price_anomaly', () => {
    const res = scenario(1000, 1200);
    expect(res.flags).toHaveLength(1);
    const f = res.flags[0]!;
    expect(f.flagType).toBe('price_anomaly');
    expect(f.severity).toBe('medium');
    expect(f.relatedInvoiceId).toBe('P');
    expect(f.details).toContain('ООО Тест');
    expect(f.details).toContain('20.0%');
  });

  it('нет аномалии: +5% (<= порога 10)', () => {
    expect(scenario(1000, 1050).flags).toHaveLength(0);
  });

  it('граница: ровно +10% не флагируется; +10.1% флагируется (строгое >)', () => {
    expect(scenario(1000, 1100).flags).toHaveLength(0);
    expect(scenario(1000, 1101).flags).toHaveLength(1);
  });

  it('другой поставщик → нет флага', () => {
    expect(scenario(1000, 1200, { prevSup: 'ООО A', curSup: 'ООО B' }).flags).toHaveLength(0);
  });

  it('нет предыдущих покупок → нет флага', () => {
    const invoices = [inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО Тест' })];
    const items = [item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 5000 })];
    expect(detectInvoiceAnomalies('C', [items[0]!], dataset(invoices, items, N0)).flags).toHaveLength(0);
  });

  it('цена ниже прошлой → нет флага', () => {
    expect(scenario(1000, 800).flags).toHaveLength(0);
  });

  it('несколько prior того же поставщика → сравнение с самой свежей', () => {
    const invoices = [
      inv({ id: 'P1', recognizedDate: '2026-01-01', supplierName: 'ООО Тест' }),
      inv({ id: 'P2', recognizedDate: '2026-02-01', supplierName: 'ООО Тест' }),
      inv({ id: 'C', recognizedDate: '2026-06-01', supplierName: 'ООО Тест' }),
    ];
    const items = [
      item({ id: 'p1', invoiceId: 'P1', matchedNomenclatureId: 'N1', unitPrice: 500 }),
      item({ id: 'p2', invoiceId: 'P2', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', unitPrice: 1200 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[2]!], dataset(invoices, items, N0));
    expect(res.flags[0]!.relatedInvoiceId).toBe('P2'); // 20% vs 1000, не vs 500
    expect(res.flags[0]!.details).toContain('20.0%');
  });
});
