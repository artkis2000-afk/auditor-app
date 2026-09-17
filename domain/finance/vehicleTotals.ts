import type { Vehicle } from '../../shared/index.js';
import type { FinanceItem } from './types.js';
import { itemCost } from './warehouseDistribution.js';

export interface VehicleStats<T extends FinanceItem = FinanceItem> {
  vehicle: Vehicle;
  directItems: T[];
  directSum: number;
  sharedSum: number;
  totalCost: number;
  partsCount: number;
}

/**
 * Итоги по каждой машине: прямые позиции + доля общего склада.
 * Дословный перенос vehicleStats из FleetFinanceView.tsx.
 */
export function computeVehicleStats<T extends FinanceItem>(
  periodItems: T[],
  sharedCostPerVehicle: Record<string, number>,
  vehicles: Vehicle[],
  selectedSupplier: string,
): VehicleStats<T>[] {
  return vehicles.map((v) => {
    const directItems = periodItems.filter(
      (i) =>
        i.vehicleId === v.id &&
        (selectedSupplier === 'all' || (!!i.supplierName && i.supplierName.trim() === selectedSupplier)),
    );
    const directSum = directItems.reduce((acc, i) => acc + itemCost(i), 0);
    const sharedSum = sharedCostPerVehicle[v.id] || 0;
    const totalCost = directSum + sharedSum;

    return {
      vehicle: v,
      directItems,
      directSum,
      sharedSum,
      totalCost,
      partsCount: directItems.length,
    };
  });
}

/** Суммарные расходы по автопарку. */
export function totalFleetCost(vehicleStats: VehicleStats[]): number {
  return vehicleStats.reduce((acc, vs) => acc + vs.totalCost, 0);
}

/** Средние расходы на машину (округление, деление на число машин, минимум 1). */
export function avgCostPerTruck(total: number, vehiclesCount: number): number {
  return Math.round(total / (vehiclesCount || 1));
}
