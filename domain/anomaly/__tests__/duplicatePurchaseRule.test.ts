import { describe, it, expect } from 'vitest';
import { detectInvoiceAnomalies } from '../anomalyEngine.js';
import { inv, item, nom, dataset } from './_fixtures.js';

// Изолируем правило дубликатов: цены равны → price-правила не срабатывают.
const N = (days: number) => [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: days })];

describe('duplicatePurchaseRule (через detectInvoiceAnomalies)', () => {
  it('положительный: повтор той же машины в пределах норматива → high/duplicate_exceed', () => {
    const invoices = [
      inv({ id: 'P', recognizedDate: '2026-01-01' }),
      inv({ id: 'C', recognizedDate: '2026-02-01' }),
    ];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const ds = dataset(invoices, items, N(180));
    const res = detectInvoiceAnomalies('C', [items[1]!], ds);
    expect(res.flags).toHaveLength(1);
    const f = res.flags[0]!;
    expect(f.flagType).toBe('duplicate_exceed');
    expect(f.severity).toBe('high');
    expect(f.relatedInvoiceId).toBe('P');
    expect(f.invoiceItemId).toBe('ci');
    expect(f.details).toContain('Вольво 569');
    expect(f.details).toContain('через 31 дней');
    expect(f.details).toContain('Нормативный срок износа: 180 дней');
    expect(res.invoiceStatus).toBe('flagged');
  });

  it('нет аномалии: интервал больше норматива', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: '2026-08-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180)));
    expect(res.flags).toHaveLength(0);
    expect(res.invoiceStatus).toBe('confirmed');
  });

  it('граница: diffDays == normDays → флаг; diffDays > normDays → нет', () => {
    const mk = (curDate: string) => {
      const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: curDate })];
      const items = [
        item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ];
      return detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(31)));
    };
    expect(mk('2026-02-01').flags).toHaveLength(1); // 31 == 31
    expect(mk('2026-02-02').flags).toHaveLength(0); // 32 > 31
  });

  it('разные машины (обе заданы) → нет дубликата', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-scania', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    expect(detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180))).flags).toHaveLength(0);
  });

  it('разные узлы (оба заданы, не none) → нет дубликата', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', truckPlacement: 'steering_right', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', truckPlacement: 'steering_left', unitPrice: 1000 }),
    ];
    expect(detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180))).flags).toHaveLength(0);
  });

  it('машина задана только у одной позиции → дубликат срабатывает', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', unitPrice: 1000 }), // без vehicleId
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180)));
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]!.flagType).toBe('duplicate_exceed');
  });

  it('normativeServiceDays = 0 → правило отключено', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-01-01' }), inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    expect(detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(0))).flags).toHaveLength(0);
  });

  it('несколько prior → relatedInvoiceId указывает на самую свежую предыдущую', () => {
    const invoices = [
      inv({ id: 'P1', recognizedDate: '2026-01-01' }),
      inv({ id: 'P2', recognizedDate: '2026-01-20' }),
      inv({ id: 'C', recognizedDate: '2026-02-01' }),
    ];
    const items = [
      item({ id: 'p1', invoiceId: 'P1', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'p2', invoiceId: 'P2', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[2]!], dataset(invoices, items, N(180)));
    expect(res.flags[0]!.relatedInvoiceId).toBe('P2');
  });

  it('покупка в тот же день (другая накладная) → дубликат, «через 0 дней»', () => {
    const invoices = [inv({ id: 'P', recognizedDate: '2026-02-01' }), inv({ id: 'C', recognizedDate: '2026-02-01' })];
    const items = [
      item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    ];
    const res = detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180)));
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]!.details).toContain('через 0 дней');
  });

  it('prior в статусе processing/draft не учитывается', () => {
    for (const status of ['processing', 'draft'] as const) {
      const invoices = [
        inv({ id: 'P', recognizedDate: '2026-01-01', status }),
        inv({ id: 'C', recognizedDate: '2026-02-01' }),
      ];
      const items = [
        item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ];
      expect(detectInvoiceAnomalies('C', [items[1]!], dataset(invoices, items, N(180))).flags).toHaveLength(0);
    }
  });
});
