import { describe, it, expect } from 'vitest';
import { detectPlacementFromText } from '../placementDetection.js';

describe('detectPlacementFromText — коды 1..13 через «= <код>»', () => {
  const map: Array<[string, string]> = [
    ['= 1', 'cabin'],
    ['= 2', 'steering_left'],
    ['= 3', 'steering_right'],
    ['= 4', 'driving_left_outer'],
    ['= 5', 'driving_right_outer'],
    ['= 6', 'trailer_1_left'],
    ['= 7', 'trailer_1_right'],
    ['= 8', 'trailer_2_left'],
    ['= 9', 'trailer_2_right'],
    ['= 10', 'trailer_3_left'],
    ['= 11', 'trailer_3_right'],
    ['= 12', 'tractor_frame'],
    ['= 13', 'trailer_body'],
  ];
  for (const [input, expected] of map) {
    it(`деталь ${input} → ${expected}`, () => {
      expect(detectPlacementFromText(`Фильтр ${input}`)).toBe(expected);
    });
  }
});

describe('detectPlacementFromText — «*» = внутреннее колесо', () => {
  it('= 4* → driving_left_inner', () => {
    expect(detectPlacementFromText('Диск = 4*')).toBe('driving_left_inner');
  });
  it('= 5* → driving_right_inner', () => {
    expect(detectPlacementFromText('Диск = 5*')).toBe('driving_right_inner');
  });
});

describe('detectPlacementFromText — выбор по индексу при нескольких кодах', () => {
  it('«= 1 и 5 и 5», index 0 → cabin', () => {
    expect(detectPlacementFromText('Деталь = 1 и 5 и 5', 0)).toBe('cabin');
  });
  it('«= 1 и 5 и 5», index 1 → driving_right_outer', () => {
    expect(detectPlacementFromText('Деталь = 1 и 5 и 5', 1)).toBe('driving_right_outer');
  });
  it('«= 1 и 5 и 5», index 2 → driving_right_outer', () => {
    expect(detectPlacementFromText('Деталь = 1 и 5 и 5', 2)).toBe('driving_right_outer');
  });
  it('«= 1 и 5 и 5» без индекса → первый код (cabin)', () => {
    expect(detectPlacementFromText('Деталь = 1 и 5 и 5')).toBe('cabin');
  });
});

describe('detectPlacementFromText — формат «код <число>»', () => {
  it('код 1 → cabin', () => {
    expect(detectPlacementFromText('код 1')).toBe('cabin');
  });
  it('код 5* → driving_right_inner', () => {
    expect(detectPlacementFromText('код 5*')).toBe('driving_right_inner');
  });
});

describe('detectPlacementFromText — текстовые правила', () => {
  it('кабина → cabin', () => {
    expect(detectPlacementFromText('деталь в кабину')).toBe('cabin');
  });
  it('рама тягача → tractor_frame', () => {
    expect(detectPlacementFromText('рама тягача')).toBe('tractor_frame');
  });
  it('полуприцеп → trailer_body', () => {
    expect(detectPlacementFromText('на полуприцеп')).toBe('trailer_body');
  });
  it('передний левый → steering_left', () => {
    expect(detectPlacementFromText('передний левый')).toBe('steering_left');
  });
  it('передний правый → steering_right', () => {
    expect(detectPlacementFromText('передний правый')).toBe('steering_right');
  });
  it('ходовая левая крайняя → driving_left_outer', () => {
    expect(detectPlacementFromText('ходовая левая крайняя')).toBe('driving_left_outer');
  });
  it('ходовая правая ближняя → driving_right_inner', () => {
    expect(detectPlacementFromText('ходовая правая ближняя')).toBe('driving_right_inner');
  });
});

describe('detectPlacementFromText — оси прицепа детектируются числовыми кодами «= 6..11»', () => {
  // (коды 6..11 также покрыты в блоке «коды 1..13»; здесь — акцент на осях прицепа)
  it('= 6 → trailer_1_left', () => {
    expect(detectPlacementFromText('Диск = 6')).toBe('trailer_1_left');
  });
  it('= 9 → trailer_2_right', () => {
    expect(detectPlacementFromText('Диск = 9')).toBe('trailer_2_right');
  });
});

describe('detectPlacementFromText — сокращения п/л, п/п НЕ срабатывают (латентный баг оригинала, KI-3)', () => {
  // В исходной системе шаблоны вида /..п\/?л\b/ не матчат кириллицу из-за \b (только ASCII \w).
  // Переносим как есть: такие строки → null. Детект осей — только числовыми кодами «= 6..11».
  it('«1 п/л» → null', () => {
    expect(detectPlacementFromText('1 п/л')).toBeNull();
  });
  it('«2 п/п» → null', () => {
    expect(detectPlacementFromText('2 п/п')).toBeNull();
  });
});

describe('detectPlacementFromText — нет совпадения', () => {
  it('пустая строка → null', () => {
    expect(detectPlacementFromText('')).toBeNull();
  });
  it('обычное имя без пометок → null', () => {
    expect(detectPlacementFromText('просто болт')).toBeNull();
  });
});
