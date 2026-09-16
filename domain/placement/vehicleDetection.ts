/**
 * Определение автомобиля по тексту (рукописные пометки, госномера, бренды, designation).
 * Дословный перенос detectVehicleFromText из исходного serverDb.ts. Поведение 1:1.
 *
 * Возвращает id машины ('v-volvo', 'v-volvo-177', ...) или null.
 * Особое внимание — V177 и его ошибочно распознанные варианты (12177/12127/11727/1727/l2177/l2127),
 * так как рукописная «V177» часто читается OCR неверно. Это критическая часть системы.
 *
 * Чистая функция без I/O — пригодна для инъекции в matching (options.detectVehicle).
 */
export function detectVehicleFromText(text: string): string | null {
  if (!text) return null;

  // Приведение к нижнему регистру для устойчивой обработки
  let t = text.toLowerCase().trim();

  // Если есть знак равенства — сначала пробуем извлечь машину из левой части
  if (t.includes('=')) {
    const leftPart = (t.split('=')[0] ?? '').trim();
    if (leftPart) {
      const vehicleFromLeft = detectVehicleFromText(leftPart);
      if (vehicleFromLeft) return vehicleFromLeft;
    }
  }

  // Спец-случай: рукописное V177 (курсивная V выглядит как 12/1-2)
  // часто читается как 12177, 12127, 12-177, 12 177, 11727 (номер накладной) или 1727.
  if (/12177|12127|11727|1727|l2177|l2127/i.test(t)) {
    // Если есть слова размещения, индикатор машины или точно 12177/содержит 177 — это V177
    if (
      /п\/?п|гол|прав|лев|ось|рул|вед|запас|колес|диск|детал|гайк|тягач|прицеп/i.test(t) ||
      t.includes('12177') ||
      t.includes('12127') ||
      t.includes('177') ||
      t.includes('127') ||
      t.includes('серо') ||
      t.includes('серы')
    ) {
      return 'v-volvo-177';
    }
  }

  // Индикатор цвета для серого полуприцепа (часто V177)
  if (/серо|серый|сереб/i.test(t) && /п\/?п|полуприцеп|прицеп/i.test(t)) {
    return 'v-volvo-177';
  }

  // Замена русской 'в' на 'v' перед цифрами (в курсиве/речи выглядит как v)
  t = t.replace(/\bв(?=\d)/gi, 'v');
  t = t.replace(/\bв[-_ \s]+(?=\d)/gi, 'v ');
  t = t.replace(/^[вvbуgyhи]о*/gi, 'v');
  t = t.replace(/\b[вvbуgyhи]о*\b/gi, 'v');

  // Исправление частых OCR-ошибок, где цифры выглядят как буквы/разделители
  t = t.replace(/\bv[-_ \s]*[li|!](?=\d)/gi, 'v1');
  t = t.replace(/([v\d])[-_ \s]*[li|!](?=\d)/gi, '$11');

  // Проверка кода/номера с необязательными пробелами/дефисами
  const hasPattern = (pattern: string): boolean => {
    const regexStr = pattern.split('').join('[-_ ]*');
    const regex = new RegExp(regexStr, 'i');
    return regex.test(t);
  };

  // 1. Точные номера или буквы госномеров для каждой машины (высокая точность)
  if (t.includes('177') || hasPattern('177') || /кн[-_ ]*44/i.test(t) || /kn[-_ ]*44/i.test(t)) return 'v-volvo-177';
  if (t.includes('569') || hasPattern('569') || /ек[-_ ]*67/i.test(t) || /ek[-_ ]*67/i.test(t)) return 'v-volvo';
  if (t.includes('563') || hasPattern('563')) return 'v-scania';
  if (t.includes('967') || hasPattern('967') || /ср[-_ ]*44/i.test(t) || /sr[-_ ]*44/i.test(t)) return 'v-kamaz';
  if (t.includes('300') || hasPattern('300') || /ех[-_ ]*76/i.test(t) || /ex[-_ ]*76/i.test(t)) return 'v-man';
  if (t.includes('548') || hasPattern('548') || /не[-_ ]*44/i.test(t) || /ne[-_ ]*44/i.test(t)) return 'v-mercedes';
  if (t.includes('835') || hasPattern('835') || /см[-_ ]*44/i.test(t) || /sm[-_ ]*44/i.test(t)) return 'v-volvo-835';
  if (t.includes('372') || hasPattern('372') || /кх[-_ ]*76/i.test(t) || /kh[-_ ]*76/i.test(t)) return 'v-volvo-372';
  if (t.includes('829') || hasPattern('829')) return 'v-volvo-829';
  if (t.includes('652') || hasPattern('652') || /ур[-_ ]*44/i.test(t) || /ur[-_ ]*44/i.test(t)) return 'v-volvo-652';
  if (t.includes('806') || hasPattern('806') || /мх[-_ ]*76/i.test(t) || /mkh[-_ ]*76/i.test(t) || /mx[-_ ]*76/i.test(t)) return 'v-volvo-806';

  // Буквы госномеров для О 563 РВ 31 и О 829 РВ 31
  if (/рв[-_ ]*31/i.test(t) || /rv[-_ ]*31/i.test(t)) {
    if (t.includes('829') || /volvo|вольво/i.test(t)) return 'v-volvo-829';
    return 'v-scania'; // по умолчанию scania, т.к. тоже 563 РВ 31
  }

  // 2. Прямое совпадение по названию без обязательного префикса 'v'
  if (/volvo|вольво/i.test(t)) {
    if (t.includes('177') || hasPattern('177')) return 'v-volvo-177';
    if (t.includes('835') || hasPattern('835')) return 'v-volvo-835';
    if (t.includes('372') || hasPattern('372')) return 'v-volvo-372';
    if (t.includes('829') || hasPattern('829')) return 'v-volvo-829';
    if (t.includes('652') || hasPattern('652')) return 'v-volvo-652';
    if (t.includes('806') || hasPattern('806')) return 'v-volvo-806';
    if (t.includes('569') || hasPattern('569')) return 'v-volvo';
    return 'v-volvo'; // по умолчанию обычный Volvo
  }

  if (/scania|скания/i.test(t)) return 'v-scania';
  if (/kamaz|камаз/i.test(t)) return 'v-kamaz';
  if (/\bman\b/i.test(t) || /\bман\b/i.test(t) || /v[-_ ]*man/i.test(t) || /v[-_ ]*ман/i.test(t)) return 'v-man';
  if (/mercedes|мерседес|actros|актрос/i.test(t)) return 'v-mercedes';

  // 3. Формат V№/V-номер (V1/V-1/v №1/v-№ 1 и т.п.)
  const match = t.match(/\bv[-_ ]*[№#]?[-_ ]*(\d+)\b/i) || t.match(/v[-_ ]*[№#]?[-_ ]*(\d+)/i);
  if (match) {
    const num = parseInt(match[1]!, 10);
    switch (num) {
      case 1:
        return 'v-volvo';
      case 2:
        return 'v-scania';
      case 3:
        return 'v-kamaz';
      case 4:
        return 'v-man';
      case 5:
        return 'v-mercedes';
      default:
        break;
    }
  }

  return null;
}
