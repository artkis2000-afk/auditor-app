import { describe, it, expect } from 'vitest';
import type { AnomalyFlag } from '../../../shared/index.js';
import { recalculateGlobal } from '../recalculation/recalculationService.js';
import { inv, item, nom, dataset, detOpts } from './_fixtures.js';

const N180 = [nom({ id: 'N1', normalizedName: 'Фильтр', normativeServiceDays: 180 })];

function dupDataset(reconciledC = false) {
  const invoices = [
    inv({ id: 'P', recognizedDate: '2026-01-01' }),
    inv({ id: 'C', recognizedDate: '2026-02-01', isReconciled: reconciledC }),
  ];
  const items = [
    item({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
    item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
  ];
  return dataset(invoices, items, N180);
}

describe('recalculateGlobal — эталонное поведение', () => {
  it('дубликат: C→flagged, P→confirmed, один флаг high на ci', () => {
    const { flags, statuses } = recalculateGlobal(dupDataset(), [], detOpts);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.flagType).toBe('duplicate_exceed');
    expect(flags[0]!.invoiceItemId).toBe('ci');
    expect(flags[0]!.isResolved).toBe(false);
    expect(statuses.get('P')).toBe('confirmed');
    expect(statuses.get('C')).toBe('flagged');
  });

  it('сохранение resolved: ранее разрешённый флаг остаётся resolved, статус C→confirmed', () => {
    const existing: AnomalyFlag[] = [
      {
        id: 'old',
        invoiceId: 'C',
        invoiceItemId: 'ci',
        relatedInvoiceId: 'P',
        flagType: 'duplicate_exceed',
        details: 'ранее',
        severity: 'high',
        isResolved: true,
        resolvedBy: 'boss',
        resolvedAt: '2026-02-05T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ];
    const { flags, statuses } = recalculateGlobal(dupDataset(), existing, detOpts);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.isResolved).toBe(true);
    expect(flags[0]!.resolvedBy).toBe('boss');
    expect(flags[0]!.resolvedAt).toBe('2026-02-05T00:00:00.000Z');
    expect(statuses.get('C')).toBe('confirmed'); // единственный флаг разрешён
  });

  it('reconciled: C→confirmed, все флаги resolved (resolvedBy "Сверено")', () => {
    const { flags, statuses } = recalculateGlobal(dupDataset(true), [], detOpts);
    expect(statuses.get('C')).toBe('confirmed');
    expect(flags[0]!.isResolved).toBe(true);
    expect(flags[0]!.resolvedBy).toBe('Сверено');
    expect(flags[0]!.resolvedAt).toBe('2026-09-17T00:00:00.000Z'); // now() из detOpts
  });

  it('есть хотя бы один unresolved → flagged', () => {
    const { statuses } = recalculateGlobal(dupDataset(), [], detOpts);
    expect(statuses.get('C')).toBe('flagged');
  });
});
