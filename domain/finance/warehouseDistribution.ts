import type { Vehicle } from '../../shared/index.js';
import type { FinanceItem } from './types.js';
import { parseDateParts } from './dateParts.js';

/** Стоимость позиции: lineSum либо quantity*unitPrice (как в оригинале, через ||). */
export function itemCost(item: FinanceItem): number {
  return item.lineSum || item.quantity * item.unitPrice;
}

/**
 * Позиции общего склада в периоде: vehicleId === 'GENERAL' или пустой,
 * с необязательной фильтрацией по поставщику. Перенос из FleetFinanceView.tsx.
 */
export function filterSharedWarehouseItems<T extends FinanceItem>(periodItems: T[], selectedSupplier: string): T[] {
  return periodItems.filter(
    (i) =>
      (i.vehicleId === 'GENERAL' || !i.vehicleId) &&
      (selectedSupplier === 'all' || (!!i.supplierName && i.supplierName.trim() === selectedSupplier)),
  );
}

/** Сумма общего склада в периоде. */
export function totalSharedWarehouseSum(sharedWarehouseItems: FinanceItem[]): number {
  return sharedWarehouseItems.reduce((acc, i) => acc + itemCost(i), 0);
}

/**
 * Распределение стоимости общего склада по машинам за период.
 * Дословный перенос sharedCostPerVehicle из FleetFinanceView.tsx:
 * для каждой позиции берётся её месяц, множество исключённых за этот месяц машин,
 * стоимость делится поровну между активными машинами; итог округляется до 2 знаков.
 */
export function computeSharedCostPerVehicle(
  sharedWarehouseItems: FinanceItem[],
  exclusionsMap: Map<string, Set<string>>,
  vehicles: Vehicle[],
): Record<string, number> {
  const costMap: Record<string, number> = {};
  vehicles.forEach((v) => {
    costMap[v.id] = 0;
  });

  sharedWarehouseItems.forEach((item) => {
    const cost = itemCost(item);
    const { year: itemYear, month: itemMonth } = parseDateParts(item.recognizedDate);

    const key = `${itemYear}-${itemMonth}`;
    const excludedSet = exclusionsMap.get(key) || new Set<string>();

    const activeVehicles = vehicles.filter((v) => {
      const normId = v.id.trim().toLowerCase();
      return !excludedSet.has(v.id) && !excludedSet.has(normId);
    });
    const activeCount = activeVehicles.length || vehicles.length || 1;
    const sharePerTruck = cost / activeCount;

    activeVehicles.forEach((v) => {
      costMap[v.id] = (costMap[v.id] || 0) + sharePerTruck;
    });
  });

  // Округление до 2 знаков (как в оригинале)
  Object.keys(costMap).forEach((vId) => {
    costMap[vId] = Math.round((costMap[vId] ?? 0) * 100) / 100;
  });

  return costMap;
}
