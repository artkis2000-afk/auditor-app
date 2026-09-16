import { describe, it, expect } from 'vitest';
import {
  findBestNomenclatureMatches,
  type NomenclatureMatchInput,
  type AliasMatchInput,
} from '../nomenclatureMatching.js';

const nom = (
  id: string,
  normalizedName: string,
  vehicleId?: string | null,
): NomenclatureMatchInput => ({ id, normalizedName, vehicleId: vehicleId ?? undefined, deletedAt: null });

describe('findBestNomenclatureMatches', () => {
  it('точное совпадение имени → score 1', () => {
    const res = findBestNomenclatureMatches('Фильтр масляный Volvo', [nom('n-1', 'Фильтр масляный Volvo')], []);
    expect(res[0]!.nomenclatureId).toBe('n-1');
    expect(res[0]!.score).toBe(1);
  });

  it('подстрочное вхождение задаёт нижний порог 0.75', () => {
    const res = findBestNomenclatureMatches('Купили Фильтр для машины срочно', [nom('n-1', 'Фильтр')], []);
    expect(res[0]!.score).toBeCloseTo(0.75, 10);
  });

  it('алиас повышает score (сопоставление по синониму)', () => {
    const aliases: AliasMatchInput[] = [{ nomenclatureId: 'n-1', aliasName: 'Фильтр масляный' }];
    const res = findBestNomenclatureMatches('Фильтр масляный', [nom('n-1', 'QWERTYUIOP')], aliases);
    expect(res[0]!.nomenclatureId).toBe('n-1');
    expect(res[0]!.score).toBe(1);
  });

  it('противоположные детали исключаются (левый vs правый)', () => {
    const res = findBestNomenclatureMatches(
      'Колодка левая',
      [nom('left', 'Колодка левая'), nom('right', 'Колодка правая')],
      [],
    );
    expect(res).toHaveLength(1);
    expect(res[0]!.nomenclatureId).toBe('left');
  });

  it('удалённые (deletedAt) исключаются', () => {
    const items: NomenclatureMatchInput[] = [
      { id: 'a', normalizedName: 'Фильтр', deletedAt: '2026-01-01T00:00:00Z' },
      { id: 'b', normalizedName: 'Фильтр', deletedAt: null },
    ];
    const res = findBestNomenclatureMatches('Фильтр', items, []);
    expect(res).toHaveLength(1);
    expect(res[0]!.nomenclatureId).toBe('b');
  });

  it('vehicle boost: +0.20 для совпавшей машины, −0.40 для другой', () => {
    const items = [nom('volvo', 'Фильтр', 'v-volvo'), nom('scania', 'Фильтр', 'v-scania')];
    const res = findBestNomenclatureMatches('Фильтр', items, [], { detectVehicle: () => 'v-volvo' });
    // base = 1 (точное имя + подстрока). volvo: min(1, 1+0.2)=1; scania: min(1, max(0, 1-0.4))=0.6
    const volvo = res.find((r) => r.nomenclatureId === 'volvo')!;
    const scania = res.find((r) => r.nomenclatureId === 'scania')!;
    expect(volvo.score).toBe(1);
    expect(scania.score).toBeCloseTo(0.6, 10);
    expect(res[0]!.nomenclatureId).toBe('volvo'); // отсортировано по убыванию
  });

  it('clamp нижней границы: −0.40 не уводит score ниже 0', () => {
    const items = [nom('x', 'ЯЯЯЯ', 'v-scania')];
    const res = findBestNomenclatureMatches('Фильтр', items, [], { detectVehicle: () => 'v-volvo' });
    expect(res[0]!.score).toBe(0);
  });

  it('без detectVehicle boost не применяется (шов инъекции)', () => {
    const items = [nom('volvo', 'Фильтр', 'v-volvo'), nom('scania', 'Фильтр', 'v-scania')];
    const res = findBestNomenclatureMatches('Фильтр', items, []);
    expect(res.every((r) => r.score === 1)).toBe(true);
    expect(res).toHaveLength(2);
  });

  it('boost не применяется, если у номенклатуры нет vehicleId', () => {
    const items = [nom('novehicle', 'Фильтр')]; // vehicleId undefined
    const res = findBestNomenclatureMatches('Фильтр', items, [], { detectVehicle: () => 'v-volvo' });
    expect(res[0]!.score).toBe(1); // ни +0.2, ни −0.4
  });

  it('возвращает не более 3 кандидатов (top-3)', () => {
    const items = [
      nom('n0', 'Фильтр'),
      nom('n1', 'Фильтр1'),
      nom('n2', 'Фильтр12'),
      nom('n3', 'Фильтр123'),
      nom('n4', 'Фильтр1234'),
    ];
    const res = findBestNomenclatureMatches('Фильтр', items, []);
    expect(res).toHaveLength(3);
  });
});
