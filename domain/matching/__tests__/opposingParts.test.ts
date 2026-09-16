import { describe, it, expect } from 'vitest';
import { areOpposingParts } from '../opposingParts.js';

describe('areOpposingParts — точные противопоставления', () => {
  it('левый / правый', () => {
    expect(areOpposingParts('Колодка левый', 'Колодка правый')).toBe(true);
  });
  it('левая / правая', () => {
    expect(areOpposingParts('Фара левая', 'Фара правая')).toBe(true);
  });
  it('левое / правое', () => {
    expect(areOpposingParts('Крыло левое', 'Крыло правое')).toBe(true);
  });
  it('передний / задний', () => {
    expect(areOpposingParts('Амортизатор передний', 'Амортизатор задний')).toBe(true);
  });
  it('верхний / нижний', () => {
    expect(areOpposingParts('Рычаг верхний', 'Рычаг нижний')).toBe(true);
  });
  it('внутренний / наружный', () => {
    expect(areOpposingParts('Подшипник внутренний', 'Подшипник наружный')).toBe(true);
  });
});

describe('areOpposingParts — НЕ противоположные', () => {
  it('одинаковые дескрипторы', () => {
    expect(areOpposingParts('Колодка левая', 'Колодка левая')).toBe(false);
  });
  it('без дескрипторов направления', () => {
    expect(areOpposingParts('Фильтр масляный', 'Фильтр топливный')).toBe(false);
  });
  it('дескриптор только с одной стороны (в exact-паре не срабатывает)', () => {
    // present2 пустой → точная пара не даёт true; проверяем именно false для «левая» vs без стороны
    expect(areOpposingParts('Фара левая', 'Фара')).toBe(false);
  });
});

describe('areOpposingParts — префиксные пары (лев/прав через основы)', () => {
  it('основы "лев"/"прав": левое vs правое ближнее', () => {
    expect(areOpposingParts('колесо левое', 'колесо правое ближнее')).toBe(true);
  });
  it('передн / задн основы', () => {
    expect(areOpposingParts('мост передний привод', 'мост задний')).toBe(true);
  });
  it('english left/right', () => {
    expect(areOpposingParts('left brake pad', 'right brake pad')).toBe(true);
  });
});
