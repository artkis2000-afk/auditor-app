import { describe, it, expect } from 'vitest';
import { splitRawNameByQuantity } from '../quantitySplit.js';

describe('splitRawNameByQuantity', () => {
  it('quantity <= 1 → возвращает исходное имя без изменений', () => {
    expect(splitRawNameByQuantity('Фильтр', 1)).toEqual(['Фильтр']);
  });

  it('мульти-машинная аллокация: «V652 = 1 (2 шт) и V967 = 1 (2 шт)»', () => {
    const res = splitRawNameByQuantity('Щётка V652 = 1 (2 шт) и V967 = 1 (2 шт)', 4);
    expect(res).toEqual([
      'Щётка V652 = 1',
      'Щётка V652 = 1',
      'Щётка V967 = 1',
      'Щётка V967 = 1',
    ]);
  });

  it('одиночная аллокация с количеством: «V569 = 4 (3 шт)»', () => {
    const res = splitRawNameByQuantity('Диск V569 = 4 (3 шт)', 3);
    expect(res).toEqual(['Диск V569 = 4', 'Диск V569 = 4', 'Диск V569 = 4']);
  });

  it('резерв через «=» с несколькими кодами: «V829 = 4 и 5»', () => {
    const res = splitRawNameByQuantity('Гайка V829 = 4 и 5', 2);
    expect(res).toEqual(['Гайка V829 = 4', 'Гайка V829 = 5']);
  });

  it('«2 На все» — общий расход, разбиения нет → реплика имени', () => {
    const raw = 'Антифриз 10л 2 На все';
    expect(splitRawNameByQuantity(raw, 2)).toEqual([raw, raw]);
  });

  it('нет пометок и «=» → простая реплика по количеству', () => {
    const raw = 'Болт М10';
    expect(splitRawNameByQuantity(raw, 3)).toEqual([raw, raw, raw]);
  });

  it('аллокаций меньше количества → добивание последней аллокацией', () => {
    // одна аллокация на 1 шт, но quantity 3 → добить последней
    const res = splitRawNameByQuantity('Диск V569 = 4 (1 шт)', 3);
    expect(res).toEqual(['Диск V569 = 4', 'Диск V569 = 4', 'Диск V569 = 4']);
  });
});
