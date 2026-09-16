import { describe, it, expect } from 'vitest';
import type { AnomalyFlag } from '../../../shared/index.js';
import type { AnomalyDataset } from '../types.js';
import { recalculate, recalculateGlobal } from '../recalculation/recalculationService.js';
import type { AnomalyChange } from '../recalculation/dependencyModel.js';
import { inv, item, nom, dataset, detOpts, makeConsistent, normFlags, statusesToObj } from './_fixtures.js';

const N = (id: string, days = 180) => nom({ id, normalizedName: id, normativeServiceDays: days });

/**
 * Ядро проверки dependency-модели: инкрементальный (scoped) пересчёт по change
 * ДОЛЖЕН совпадать с авторитетным полным (global) пересчётом на изменённых данных.
 * (Если бы модель недооценивала scope — здесь бы возник counterexample.)
 */
function expectScopedEqualsGlobal(dsAfter: AnomalyDataset, existing: AnomalyFlag[], change: AnomalyChange) {
  const scoped = recalculate(dsAfter, existing, change, detOpts);
  const truth = recalculateGlobal(dsAfter, existing, detOpts);
  expect(normFlags(scoped.flags)).toEqual(normFlags(truth.flags));
  expect(statusesToObj(scoped.statuses)).toEqual(statusesToObj(truth.statuses));
  return scoped;
}

describe('dependencyModel — scoped == global', () => {
  it('append последней накладной → local; C flagged (dup vs B)', () => {
    const ds = dataset(
      [inv({ id: 'A', recognizedDate: '2026-01-01' }), inv({ id: 'B', recognizedDate: '2026-02-01' })],
      [
        item({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      [N('N1')],
    );
    const existing = makeConsistent(ds);
    // append C
    ds.invoices.push(inv({ id: 'C', recognizedDate: '2026-03-01' }));
    ds.invoiceItems.push(item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }));
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'invoice_appended',
      invoiceId: 'C',
      date: '2026-03-01',
      nomenclatureIds: ['N1'],
    });
    expect(scoped.scope.mode).toBe('local');
    expect(scoped.statuses.get('C')).toBe('flagged');
  });

  it('исторический insert → chain; влияет на последующие B/C (A→B→C)', () => {
    const ds = dataset(
      [inv({ id: 'B', recognizedDate: '2026-02-01' }), inv({ id: 'C', recognizedDate: '2026-03-01' })],
      [
        item({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      [N('N1')],
    );
    const existing = makeConsistent(ds);
    ds.invoices.push(inv({ id: 'A', recognizedDate: '2026-01-01' }));
    ds.invoiceItems.push(item({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }));
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'invoice_appended',
      invoiceId: 'A',
      date: '2026-01-01',
      nomenclatureIds: ['N1'],
    });
    expect(scoped.scope.mode).toBe('chain');
    expect(scoped.recomputedInvoiceIds.sort()).toEqual(['A', 'B', 'C']);
  });

  it('N1 ≠ N2: изменение в N1 не затрагивает накладные N2', () => {
    const ds = dataset(
      [
        inv({ id: 'A1', recognizedDate: '2026-01-01' }),
        inv({ id: 'B1', recognizedDate: '2026-02-01' }),
        inv({ id: 'A2', recognizedDate: '2026-01-01' }),
        inv({ id: 'B2', recognizedDate: '2026-02-01' }),
      ],
      [
        item({ id: 'a1', invoiceId: 'A1', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'b1', invoiceId: 'B1', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'a2', invoiceId: 'A2', matchedNomenclatureId: 'N2', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'b2', invoiceId: 'B2', matchedNomenclatureId: 'N2', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      [N('N1'), N('N2')],
    );
    const existing = makeConsistent(ds);
    // меняем цену позиции N1 (b1)
    const b1 = ds.invoiceItems.find((i) => i.id === 'b1')!;
    b1.unitPrice = 2000;
    b1.lineSum = 2000;
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'item_attributes_changed',
      nomenclatureIds: ['N1'],
      fromDate: '2026-02-01',
    });
    expect(scoped.recomputedInvoiceIds).not.toContain('A2');
    expect(scoped.recomputedInvoiceIds).not.toContain('B2');
  });

  it('смена номенклатуры N1→N2 → пересчёт обеих цепочек', () => {
    const ds = dataset(
      [
        inv({ id: 'W', recognizedDate: '2026-01-01' }),
        inv({ id: 'X', recognizedDate: '2026-02-01' }),
        inv({ id: 'Y', recognizedDate: '2026-03-01' }),
        inv({ id: 'Z', recognizedDate: '2026-03-15' }),
      ],
      [
        item({ id: 'wi', invoiceId: 'W', matchedNomenclatureId: 'N2', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'xi', invoiceId: 'X', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'yi', invoiceId: 'Y', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'zi', invoiceId: 'Z', matchedNomenclatureId: 'N2', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      [N('N1'), N('N2')],
    );
    const existing = makeConsistent(ds);
    // xi: N1 → N2
    const xi = ds.invoiceItems.find((i) => i.id === 'xi')!;
    xi.matchedNomenclatureId = 'N2';
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'item_nomenclature_changed',
      oldNomenclatureId: 'N1',
      newNomenclatureId: 'N2',
      fromDate: '2026-02-01',
    });
    expect(scoped.scope.mode).toBe('chain');
    expect(scoped.recomputedInvoiceIds.sort()).toEqual(['X', 'Y', 'Z']); // W (Jan) не затронут
  });

  it('смена settings threshold → global', () => {
    const ds = dataset(
      [
        inv({ id: 'A', recognizedDate: '2026-01-01', supplierName: 'ООО Тест' }),
        inv({ id: 'B', recognizedDate: '2026-06-01', supplierName: 'ООО Тест' }),
      ],
      [
        item({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', unitPrice: 1000 }),
        item({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', unitPrice: 1200 }),
      ],
      [N('N1', 0)],
    );
    const existing = makeConsistent(ds);
    expect(existing.some((f) => f.invoiceId === 'B')).toBe(true); // при пороге 10 есть флаг
    ds.settings.anomalyThreshold = 50; // теперь 20% < 50 → флаг исчезает
    const scoped = expectScopedEqualsGlobal(ds, existing, { kind: 'settings_changed' });
    expect(scoped.scope.mode).toBe('global');
    expect(scoped.statuses.get('B')).toBe('confirmed');
  });

  it('граница «того же дня»: append B в тот же день пересчитывает и A', () => {
    const ds = dataset(
      [inv({ id: 'A', recognizedDate: '2026-02-01' })],
      [item({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 })],
      [N('N1')],
    );
    const existing = makeConsistent(ds);
    ds.invoices.push(inv({ id: 'B', recognizedDate: '2026-02-01' }));
    ds.invoiceItems.push(item({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }));
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'invoice_appended',
      invoiceId: 'B',
      date: '2026-02-01',
      nomenclatureIds: ['N1'],
    });
    expect(scoped.scope.mode).toBe('chain');
    expect(scoped.recomputedInvoiceIds).toContain('A'); // A пересчитан (B стал его same-day prior)
    expect(scoped.statuses.get('A')).toBe('flagged');
    expect(scoped.statuses.get('B')).toBe('flagged');
  });

  it('resolved сохраняется при scoped-пересчёте', () => {
    const ds = dataset(
      [inv({ id: 'A', recognizedDate: '2026-01-01' }), inv({ id: 'B', recognizedDate: '2026-02-01' })],
      [
        item({ id: 'ai', invoiceId: 'A', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
        item({ id: 'bi', invoiceId: 'B', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }),
      ],
      [N('N1')],
    );
    const existing = makeConsistent(ds); // B flagged (dup vs A)
    // пользователь разрешил флаг B (как в approve-flag: флаг resolved + статус накладной confirmed)
    for (const f of existing) {
      if (f.invoiceId === 'B') {
        f.isResolved = true;
        f.resolvedBy = 'boss';
        f.resolvedAt = '2026-02-05T00:00:00.000Z';
      }
    }
    ds.invoices.find((i) => i.id === 'B')!.status = 'confirmed'; // согласованное входное состояние
    ds.invoices.push(inv({ id: 'C', recognizedDate: '2026-03-01' }));
    ds.invoiceItems.push(item({ id: 'ci', invoiceId: 'C', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 }));
    const scoped = expectScopedEqualsGlobal(ds, existing, {
      kind: 'invoice_appended',
      invoiceId: 'C',
      date: '2026-03-01',
      nomenclatureIds: ['N1'],
    });
    // флаг B остаётся разрешённым, B → confirmed; C flagged
    const bFlag = scoped.flags.find((f) => f.invoiceId === 'B')!;
    expect(bFlag.isResolved).toBe(true);
    expect(bFlag.resolvedBy).toBe('boss');
    expect(scoped.statuses.get('B')).toBe('confirmed');
    expect(scoped.statuses.get('C')).toBe('flagged');
  });
});
