import type { ExclusionEntry } from './types.js';

/**
 * Строит карту исключений: `${year}-${month}` → множество id исключённых машин.
 * Дословный перенос exclusionsMap из FleetFinanceView.tsx (добавляет и исходный, и нормализованный id).
 */
export function buildExclusionsMap(exclusions: ExclusionEntry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  exclusions.forEach((ex) => {
    const year = Number(ex.year);
    const month = Number(ex.month);
    const key = `${year}-${month}`;
    if (!map.has(key)) {
      map.set(key, new Set<string>());
    }
    if (ex.vehicleId) {
      const normId = ex.vehicleId.trim().toLowerCase();
      map.get(key)!.add(normId);
      map.get(key)!.add(ex.vehicleId.trim());
    }
  });
  return map;
}
