import { describe, it, expect } from 'vitest';
import { levenshteinDistance, getStringSimilarity } from '../textSimilarity.js';

describe('levenshteinDistance', () => {
  it('идентичные строки → 0', () => {
    expect(levenshteinDistance('фильтр', 'фильтр')).toBe(0);
  });

  it('регистр и пробелы по краям игнорируются (lowercase + trim)', () => {
    expect(levenshteinDistance('  Фильтр  ', 'фильтр')).toBe(0);
  });

  it('пустая строка → длина второй (обрезанной)', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abcd', '')).toBe(4);
  });

  it('одна замена', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
  });

  it('классический kitten→sitting = 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('getStringSimilarity', () => {
  it('идентичные → 1.0', () => {
    expect(getStringSimilarity('Фильтр масляный', 'Фильтр масляный')).toBe(1);
  });

  it('обе пустые → 1.0 (maxLength 0)', () => {
    expect(getStringSimilarity('', '')).toBe(1);
  });

  it('формула 1 - distance/maxLength', () => {
    // distance('abc','abd') = 1, maxLength = 3 → 1 - 1/3
    expect(getStringSimilarity('abc', 'abd')).toBeCloseTo(1 - 1 / 3, 10);
  });

  it('maxLength берётся по ИСХОДНЫМ длинам (перенос как есть): пробелы влияют на знаменатель', () => {
    // distance(trim('abc '), 'abc') = 0, но maxLength = max(4,3) = 4 → 1 - 0/4 = 1
    expect(getStringSimilarity('abc ', 'abc')).toBe(1);
    // distance(trim(' ab'),'abc') : trim=' ab'->'ab', dist('ab','abc')=1, maxLength=max(3,3)=3 → 1-1/3
    expect(getStringSimilarity(' ab', 'abc')).toBeCloseTo(1 - 1 / 3, 10);
  });
});
