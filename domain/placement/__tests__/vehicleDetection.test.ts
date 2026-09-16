import { describe, it, expect } from 'vitest';
import { detectVehicleFromText } from '../vehicleDetection.js';

describe('detectVehicleFromText — V177 и OCR-варианты (критично)', () => {
  it('V177 / V-177', () => {
    expect(detectVehicleFromText('V177')).toBe('v-volvo-177');
    expect(detectVehicleFromText('V-177')).toBe('v-volvo-177');
  });
  it('12177 (курсивная V прочитана как 12)', () => {
    expect(detectVehicleFromText('12177')).toBe('v-volvo-177');
  });
  it('12127 п/п гос серо', () => {
    expect(detectVehicleFromText('12127 п/п гос серо')).toBe('v-volvo-177');
  });
  it('l2177 (латинская L вместо 1)', () => {
    expect(detectVehicleFromText('l2177')).toBe('v-volvo-177');
  });
  it('11727 с контекстом колеса', () => {
    expect(detectVehicleFromText('колесо 11727')).toBe('v-volvo-177');
  });
  it('1727 с пометкой п/п гол', () => {
    expect(detectVehicleFromText('1727 п/п гол')).toBe('v-volvo-177');
  });
  it('серый полуприцеп → V177', () => {
    expect(detectVehicleFromText('серый полуприцеп')).toBe('v-volvo-177');
  });
  it('госномер КН 44 → V177', () => {
    expect(detectVehicleFromText('гайка кн44')).toBe('v-volvo-177');
  });
  it('V177 = 7 (извлечение из левой части до =)', () => {
    expect(detectVehicleFromText('V177 = 7')).toBe('v-volvo-177');
  });
});

describe('detectVehicleFromText — по номеру/designation', () => {
  const cases: Array<[string, string]> = [
    ['фильтр V569', 'v-volvo'],
    ['деталь 563', 'v-scania'],
    ['V967', 'v-kamaz'],
    ['деталь 300', 'v-man'],
    ['деталь 548', 'v-mercedes'],
    ['деталь 835', 'v-volvo-835'],
    ['деталь 372', 'v-volvo-372'],
    ['деталь 829', 'v-volvo-829'],
    ['деталь 652', 'v-volvo-652'],
    ['деталь 806', 'v-volvo-806'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(detectVehicleFromText(input)).toBe(expected);
    });
  }
  it('госномер ЕК 67 → v-volvo', () => {
    expect(detectVehicleFromText('фильтр ек67')).toBe('v-volvo');
  });
  it('V569 = 4 (извлечение из левой части) → v-volvo', () => {
    expect(detectVehicleFromText('V569 = 4')).toBe('v-volvo');
  });
});

describe('detectVehicleFromText — по бренду', () => {
  it('volvo (латиница) → v-volvo', () => {
    expect(detectVehicleFromText('volvo')).toBe('v-volvo');
  });
  it('scania → v-scania', () => {
    expect(detectVehicleFromText('scania')).toBe('v-scania');
  });
  it('камаз → v-kamaz', () => {
    expect(detectVehicleFromText('камаз')).toBe('v-kamaz');
  });
  it('man (слово) → v-man', () => {
    expect(detectVehicleFromText('фильтр man')).toBe('v-man');
  });
  it('actros → v-mercedes', () => {
    expect(detectVehicleFromText('actros')).toBe('v-mercedes');
  });
});

describe('detectVehicleFromText — РВ 31 (общий госномер 563/829)', () => {
  it('прицеп рв 31 (без 829/volvo) → v-scania (по умолчанию)', () => {
    expect(detectVehicleFromText('прицеп рв 31')).toBe('v-scania');
  });
  it('volvo рв 31 → v-volvo-829', () => {
    expect(detectVehicleFromText('volvo рв 31')).toBe('v-volvo-829');
  });
});

describe('detectVehicleFromText — формат V№ (легаси 1..5)', () => {
  it('V №2 → v-scania', () => {
    expect(detectVehicleFromText('V №2')).toBe('v-scania');
  });
  it('V-3 → v-kamaz', () => {
    expect(detectVehicleFromText('V-3')).toBe('v-kamaz');
  });
});

describe('detectVehicleFromText — пустое/без совпадения', () => {
  it('пустая строка → null', () => {
    expect(detectVehicleFromText('')).toBeNull();
  });
  it('нет признаков машины → null', () => {
    expect(detectVehicleFromText('просто болт')).toBeNull();
  });
});

describe('detectVehicleFromText — задокументированный quirk (перенос как есть, см. KNOWN_ISSUES KI-2)', () => {
  it('bare кириллица "вольво" → null (нормализация искажает слово; надёжен путь по номеру)', () => {
    expect(detectVehicleFromText('вольво')).toBeNull();
  });
  it('но "вольво 806" (с номером) → v-volvo-806', () => {
    expect(detectVehicleFromText('вольво 806')).toBe('v-volvo-806');
  });
});
