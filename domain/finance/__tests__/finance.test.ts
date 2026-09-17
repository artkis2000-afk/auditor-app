import { describe, it, expect } from 'vitest';
import type { Vehicle } from '../../../shared/index.js';
import type { FinanceItem, PeriodFilter } from '../types.js';
import {
  parseDateParts,
  isItemInPeriod,
  buildExclusionsMap,
  filterSharedWarehouseItems,
  totalSharedWarehouseSum,
  computeSharedCostPerVehicle,
  computeVehicleStats,
  totalFleetCost,
  avgCostPerTruck,
  computePotentialSavings,
} from '../index.js';

const veh = (id: string): Vehicle => ({ id, name: id, plate: id });
const V2 = [veh('v-volvo'), veh('v-scania')];
const V3 = [veh('a'), veh('b'), veh('c')];

const fi = (p: Partial<FinanceItem>): FinanceItem => ({ quantity: 1, unitPrice: 0, ...p });

describe('parseDateParts', () => {
  it('YYYY-MM-DD', () => expect(parseDateParts('2026-05-15')).toEqual({ year: 2026, month: 5 }));
  it('DD.MM.YYYY', () => expect(parseDateParts('15.05.2026')).toEqual({ year: 2026, month: 5 }));
  it('YYYY.MM.DD', () => expect(parseDateParts('2026.05.15')).toEqual({ year: 2026, month: 5 }));
  it('пусто → дефолт {2026,7}', () => expect(parseDateParts('')).toEqual({ year: 2026, month: 7 }));
  it('мусор → дефолт {2026,7}', () => expect(parseDateParts('abc')).toEqual({ year: 2026, month: 7 }));
});

describe('isItemInPeriod', () => {
  const item = fi({ recognizedDate: '2026-05-15' });
  const base: PeriodFilter = { periodType: 'all', selectedYear: 2026, selectedQuarter: 2, selectedMonth: 5 };
  it('all → true', () => expect(isItemInPeriod(item, base)).toBe(true));
  it('year совпадает', () => expect(isItemInPeriod(item, { ...base, periodType: 'year' })).toBe(true));
  it('year не совпадает', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'year', selectedYear: 2025 })).toBe(false));
  it('quarter совпадает (май → Q2)', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'quarter', selectedQuarter: 2 })).toBe(true));
  it('quarter не совпадает', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'quarter', selectedQuarter: 1 })).toBe(false));
  it('month совпадает', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'month', selectedMonth: 5 })).toBe(true));
  it('month не совпадает', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'month', selectedMonth: 6 })).toBe(false));
  it('custom в диапазоне', () =>
    expect(
      isItemInPeriod(item, { ...base, periodType: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' }),
    ).toBe(true));
  it('custom до начала', () =>
    expect(isItemInPeriod(item, { ...base, periodType: 'custom', startDate: '2026-06-01' })).toBe(false));
});

describe('buildExclusionsMap', () => {
  it('строит ключ год-месяц и хранит id (исходный и нормализованный)', () => {
    const map = buildExclusionsMap([{ vehicleId: 'v-scania', year: 2026, month: 7 }]);
    expect(map.get('2026-7')!.has('v-scania')).toBe(true);
  });
});

describe('computeSharedCostPerVehicle', () => {
  it('делит поровну между всеми машинами без исключений', () => {
    const items = [fi({ vehicleId: 'GENERAL', unitPrice: 1000, lineSum: 1000, recognizedDate: '2026-07-01' })];
    expect(computeSharedCostPerVehicle(items, new Map(), V2)).toEqual({ 'v-volvo': 500, 'v-scania': 500 });
  });

  it('исключённая машина не получает долю (остальные делят на меньшее число)', () => {
    const items = [fi({ vehicleId: 'GENERAL', unitPrice: 1000, lineSum: 1000, recognizedDate: '2026-07-01' })];
    const excl = buildExclusionsMap([{ vehicleId: 'v-scania', year: 2026, month: 7 }]);
    expect(computeSharedCostPerVehicle(items, excl, V2)).toEqual({ 'v-volvo': 1000, 'v-scania': 0 });
  });

  it('округление до 2 знаков (100 / 3)', () => {
    const items = [fi({ vehicleId: 'GENERAL', unitPrice: 100, lineSum: 100, recognizedDate: '2026-07-01' })];
    expect(computeSharedCostPerVehicle(items, new Map(), V3)).toEqual({ a: 33.33, b: 33.33, c: 33.33 });
  });
});

describe('filterSharedWarehouseItems / totalSharedWarehouseSum', () => {
  const items = [
    fi({ vehicleId: 'GENERAL', unitPrice: 100, lineSum: 100, supplierName: 'ООО A' }),
    fi({ vehicleId: undefined, unitPrice: 200, lineSum: 200, supplierName: 'ООО B' }),
    fi({ vehicleId: 'v-volvo', unitPrice: 999, lineSum: 999, supplierName: 'ООО A' }),
  ];
  it('оставляет только GENERAL/пустые', () => {
    expect(filterSharedWarehouseItems(items, 'all')).toHaveLength(2);
  });
  it('фильтр по поставщику', () => {
    const r = filterSharedWarehouseItems(items, 'ООО A');
    expect(r).toHaveLength(1);
    expect(r[0]!.supplierName).toBe('ООО A');
  });
  it('сумма общего склада', () => {
    expect(totalSharedWarehouseSum(filterSharedWarehouseItems(items, 'all'))).toBe(300);
  });
});

describe('computeVehicleStats / totals', () => {
  const periodItems = [
    fi({ vehicleId: 'v-volvo', unitPrice: 2000, lineSum: 2000, supplierName: 'ООО A' }),
  ];
  const shared = { 'v-volvo': 500, 'v-scania': 500 };

  it('direct + shared = total; partsCount', () => {
    const stats = computeVehicleStats(periodItems, shared, V2, 'all');
    const volvo = stats.find((s) => s.vehicle.id === 'v-volvo')!;
    const scania = stats.find((s) => s.vehicle.id === 'v-scania')!;
    expect(volvo.directSum).toBe(2000);
    expect(volvo.sharedSum).toBe(500);
    expect(volvo.totalCost).toBe(2500);
    expect(volvo.partsCount).toBe(1);
    expect(scania.totalCost).toBe(500);
  });

  it('totalFleetCost и avgCostPerTruck', () => {
    const stats = computeVehicleStats(periodItems, shared, V2, 'all');
    const total = totalFleetCost(stats);
    expect(total).toBe(3000);
    expect(avgCostPerTruck(total, V2.length)).toBe(1500);
  });

  it('фильтр по поставщику исключает прямые позиции другого поставщика', () => {
    const stats = computeVehicleStats(periodItems, shared, V2, 'ООО B');
    const volvo = stats.find((s) => s.vehicle.id === 'v-volvo')!;
    expect(volvo.directSum).toBe(0);
    expect(volvo.totalCost).toBe(500); // только shared
  });
});

describe('computePotentialSavings', () => {
  const items = [
    { id: 'i1', lineSum: 1500 },
    { id: 'i2', lineSum: 1200 },
    { id: 'i3', lineSum: 1000 },
  ];
  it('парсит % из details «завышение ... 50.0%» → экономия 500', () => {
    const flags = [{ invoiceItemId: 'i1', details: 'Завышение цены у поставщика "X" на 50.0%: ...' }];
    expect(computePotentialSavings(flags, items)).toBe(500); // 1500 - 1500/1.5
  });
  it('парсит % из «превышает ... 20.0%» → экономия 200', () => {
    const flags = [{ invoiceItemId: 'i2', details: 'Цена превышает среднюю рыночную по компании на 20.0%: ...' }];
    expect(computePotentialSavings(flags, items)).toBe(200); // 1200 - 1200/1.2
  });
  it('без процента → резерв 15% от lineSum', () => {
    const flags = [{ invoiceItemId: 'i3', details: 'нет процента' }];
    expect(computePotentialSavings(flags, items)).toBe(150);
  });
  it('несколько флагов суммируются; неизвестный item игнорируется', () => {
    const flags = [
      { invoiceItemId: 'i1', details: 'Завышение цены на 50.0%' },
      { invoiceItemId: 'zzz', details: 'Завышение цены на 50.0%' },
    ];
    expect(computePotentialSavings(flags, items)).toBe(500);
  });
});
