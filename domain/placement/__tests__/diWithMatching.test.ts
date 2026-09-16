import { describe, it, expect } from 'vitest';
import { detectVehicleFromText } from '../vehicleDetection.js';
import { findBestNomenclatureMatches, type NomenclatureMatchInput } from '../../matching/index.js';

/**
 * Проверка шва dependency injection: реальная detectVehicleFromText из placement
 * безопасно передаётся в matching и корректно активирует vehicle-boost.
 */
describe('DI: detectVehicleFromText → findBestNomenclatureMatches', () => {
  const nom = (id: string, name: string, vehicleId: string): NomenclatureMatchInput => ({
    id,
    normalizedName: name,
    vehicleId,
    deletedAt: null,
  });

  it('rawName с «V569» усиливает номенклатуру нужной машины и штрафует чужую', () => {
    const items = [nom('volvo', 'Фильтр', 'v-volvo'), nom('scania', 'Фильтр', 'v-scania')];
    const res = findBestNomenclatureMatches('Фильтр V569', items, [], {
      detectVehicle: detectVehicleFromText,
    });
    expect(res[0]!.nomenclatureId).toBe('volvo');
    const volvo = res.find((r) => r.nomenclatureId === 'volvo')!;
    const scania = res.find((r) => r.nomenclatureId === 'scania')!;
    expect(volvo.score).toBeGreaterThan(scania.score);
  });

  it('без совпадения машины в тексте boost не применяется (обе равны)', () => {
    const items = [nom('volvo', 'Фильтр', 'v-volvo'), nom('scania', 'Фильтр', 'v-scania')];
    const res = findBestNomenclatureMatches('Фильтр', items, [], {
      detectVehicle: detectVehicleFromText,
    });
    expect(res[0]!.score).toBe(res[1]!.score);
  });
});
