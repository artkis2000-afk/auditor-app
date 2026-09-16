import { describe, it, expect } from 'vitest';
import { findBestSupplierMatches, type SupplierMatchInput } from '../supplierMatching.js';

const sup = (id: string, name: string, deleted = false): SupplierMatchInput => ({
  id,
  name,
  deletedAt: deleted ? '2026-01-01T00:00:00Z' : null,
});

describe('findBestSupplierMatches', () => {
  it('совпадение после очистки орг.-правовой формы (ООО, кавычки) → score 1', () => {
    const res = findBestSupplierMatches('АвтоДетали', [sup('s-1', 'ООО "АвтоДетали"')]);
    expect(res[0]!.supplierId).toBe('s-1');
    expect(res[0]!.score).toBe(1);
  });

  it('подстрочное вхождение очищенных имён → порог 0.75', () => {
    const res = findBestSupplierMatches('Сидоров', [sup('s-2', 'ИП Сидоров Александр Петрович')]);
    expect(res[0]!.supplierId).toBe('s-2');
    expect(res[0]!.score).toBeCloseTo(0.75, 10);
  });

  it('удалённые поставщики исключаются', () => {
    const res = findBestSupplierMatches('АвтоДетали', [
      sup('s-del', 'ООО "АвтоДетали"', true),
      sup('s-ok', 'ООО "АвтоДетали Плюс"'),
    ]);
    expect(res.some((r) => r.supplierId === 's-del')).toBe(false);
    expect(res).toHaveLength(1);
  });

  it('возвращает не более 5 кандидатов (top-5)', () => {
    const suppliers = [
      sup('a', 'Компания Альфа'),
      sup('b', 'Компания Бета'),
      sup('c', 'Компания Гамма'),
      sup('d', 'Компания Дельта'),
      sup('e', 'Компания Эпсилон'),
      sup('f', 'Компания Дзета'),
    ];
    const res = findBestSupplierMatches('Компания Альфа', suppliers);
    expect(res).toHaveLength(5);
  });

  it('сортировка по убыванию score', () => {
    const res = findBestSupplierMatches('АвтоДетали', [
      sup('far', 'ЗАО Совершенно Другое Название'),
      sup('near', 'ООО "АвтоДетали"'),
    ]);
    expect(res[0]!.supplierId).toBe('near');
    expect(res[0]!.score).toBeGreaterThanOrEqual(res[1]!.score);
  });
});
