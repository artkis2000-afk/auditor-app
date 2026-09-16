import type { TruckPlacement } from '../../shared/index.js';

/**
 * Определение узла/оси/колеса по тексту (рукописные коды 1–13, «*» для внутреннего колеса,
 * формат «= <код>», выбор по индексу позиции при нескольких кодах, и текстовые правила).
 * Дословный перенос detectPlacementFromText из исходного serverDb.ts. Поведение 1:1.
 */

// Соответствие строкового кода → размещение (код с «*» = внутреннее колесо)
function mapCodeToPlacement(code: string): TruckPlacement | null {
  const codeNum = code.replace('*', '');
  const isInner = code.includes('*');
  if (codeNum === '1') return 'cabin';
  if (codeNum === '2') return 'steering_left';
  if (codeNum === '3') return 'steering_right';
  if (codeNum === '4') {
    return isInner ? 'driving_left_inner' : 'driving_left_outer';
  }
  if (codeNum === '5') {
    return isInner ? 'driving_right_inner' : 'driving_right_outer';
  }
  if (codeNum === '6') return 'trailer_1_left';
  if (codeNum === '7') return 'trailer_1_right';
  if (codeNum === '8') return 'trailer_2_left';
  if (codeNum === '9') return 'trailer_2_right';
  if (codeNum === '10') return 'trailer_3_left';
  if (codeNum === '11') return 'trailer_3_right';
  if (codeNum === '12') return 'tractor_frame';
  if (codeNum === '13') return 'trailer_body';
  return null;
}

export function detectPlacementFromText(text: string, itemIndex?: number): TruckPlacement | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // Формат «= <код>» / «=<код>» / «= <код>*». Если есть itemIndex и несколько кодов
  // после «=» (напр. «= 1 и 5 и 5») — выбираем код по индексу позиции.
  const eqIdx = t.indexOf('=');
  if (eqIdx !== -1) {
    const rightPart = t.substring(eqIdx + 1).trim();
    // Разбиваем по любому не-цифровому/не-«*» символу (пробелы, запятые, «и», латинская «u» и т.п.)
    const tokens = rightPart.split(/[^\d*]+/).map((tok) => tok.trim()).filter(Boolean);
    const codes = tokens.filter((tok) => /^\d+\*?$/.test(tok));
    if (codes.length > 0) {
      // При наличии itemIndex и нескольких кодов берём код по индексу; иначе — первый
      const code = itemIndex !== undefined && codes.length > 1 ? codes[itemIndex] : codes[0];
      if (code) {
        const mapped = mapCodeToPlacement(code);
        if (mapped) return mapped;
      }
    }
  }

  // Резерв: стандартное «= <число>» или «код <число>»
  const codeMatch = t.match(/=\s*(\d+)\s*(\*)?/i) || t.match(/код\s*(\d+)\s*(\*)?/i);
  if (codeMatch) {
    const codeNum = codeMatch[1]!;
    const isInner = codeMatch[2] === '*';
    const mapped = mapCodeToPlacement(codeNum + (isInner ? '*' : ''));
    if (mapped) return mapped;
  }

  // 1. Кабина (Код 1)
  if (/кабин/i.test(t)) return 'cabin';

  // 2. Рама тягача (Код 12)
  if (/рама/i.test(t)) return 'tractor_frame';

  // 3. Прицеп / кузов (Код 13)
  if (/прицеп|полуприцеп|кузов|будка/i.test(t)) return 'trailer_body';

  // 4. Левое рулевое (Код 2)
  if (
    /передн[ийеая]+\s+лев[ыйая]+/i.test(t) ||
    /рулев[аяые]+\s+лев[ыйая]+/i.test(t) ||
    /\bп\/?л\s+(гол|тягач)/i.test(t) ||
    /\bп\/?л\b.*(голов|тягач)/i.test(t) ||
    /(голов|тягач).*\bп\/?л\b/i.test(t) ||
    /передн[ийеая]+\s+лев[ыйая]+\s+(голов|тягач)/i.test(t)
  )
    return 'steering_left';

  // 5. Правое рулевое (Код 3)
  if (
    /передн[ийеая]+\s+прав[ыйая]+/i.test(t) ||
    /рулев[аяые]+\s+прав[ыйая]+/i.test(t) ||
    /\bп\/?п\s+(гол|тягач)/i.test(t) ||
    /\bп\/?п\b.*(голов|тягач)/i.test(t) ||
    /(голов|тягач).*\bп\/?п\b/i.test(t) ||
    /передн[ийеая]+\s+прав[ыйая]+\s+(голов|тягач)/i.test(t) ||
    /гол(ова)?\s*прав/i.test(t) || // «гол право» или «голова право»
    /п\/?п\s+гол/i.test(t) // «п/п гол»
  )
    return 'steering_right';

  // 6. Левое крайнее ведущее (Код 4)
  if (
    /ходов.*лев.*крайн/i.test(t) ||
    /задн.*лев.*крайн/i.test(t) ||
    /ведущ.*лев.*крайн/i.test(t) ||
    /левое крайнее/i.test(t)
  )
    return 'driving_left_outer';

  // 7. Левое ближнее ведущее (Код 4*)
  if (
    /ходов.*лев.*ближ/i.test(t) ||
    /задн.*лев.*ближ/i.test(t) ||
    /ведущ.*лев.*ближ/i.test(t) ||
    /левое ближнее/i.test(t)
  )
    return 'driving_left_inner';

  // 8. Правое крайнее ведущее (Код 5)
  if (
    /ходов.*прав.*крайн/i.test(t) ||
    /задн.*прав.*крайн/i.test(t) ||
    /ведущ.*прав.*крайн/i.test(t) ||
    /правое крайнее/i.test(t)
  )
    return 'driving_right_outer';

  // 9. Правое ближнее ведущее (Код 5*)
  if (
    /ходов.*прав.*ближ/i.test(t) ||
    /задн.*прав.*ближ/i.test(t) ||
    /ведущ.*прав.*ближ/i.test(t) ||
    /правое ближнее/i.test(t)
  )
    return 'driving_right_inner';

  // Резерв для общей задней/ведущей оси лев/прав, если не указано крайнее/ближнее
  if (
    /задн[ийеая]+\s+лев[ыйая]+/i.test(t) ||
    /ведущ[ийеая]+\s+лев[ыйая]+/i.test(t) ||
    /\bз\/?л\s+(гол|тягач)/i.test(t) ||
    /\bз\/?л\b.*(голов|тягач)/i.test(t) ||
    /(голов|тягач).*\bз\/?л\b/i.test(t)
  )
    return 'driving_left_outer';

  if (
    /задн[ийеая]+\s+прав[ыйая]+/i.test(t) ||
    /ведущ[ийеая]+\s+прав[ыйая]+/i.test(t) ||
    /\bз\/?п\s+(гол|тягач)/i.test(t) ||
    /\bз\/?п\b.*(голов|тягач)/i.test(t) ||
    /(голов|тягач).*\bз\/?п\b/i.test(t)
  )
    return 'driving_right_outer';

  // 10. 1-я ось прицепа лев/прав (Код 6/7)
  if (/1[-_ ]*(ось|оси)?[-_ ]*(лев|л)\b/i.test(t) || /1[-_ ]*п\/?л\b/i.test(t)) return 'trailer_1_left';
  if (/1[-_ ]*(ось|оси)?[-_ ]*(прав|п)\b/i.test(t) || /1[-_ ]*п\/?п\b/i.test(t)) return 'trailer_1_right';

  // 11. 2-я ось прицепа лев/прав (Код 8/9)
  if (/2[-_ ]*(ось|оси)?[-_ ]*(лев|л)\b/i.test(t) || /2[-_ ]*п\/?л\b/i.test(t)) return 'trailer_2_left';
  if (/2[-_ ]*(ось|оси)?[-_ ]*(прав|п)\b/i.test(t) || /2[-_ ]*п\/?п\b/i.test(t)) return 'trailer_2_right';

  // 12. 3-я ось прицепа лев/прав (Код 10/11)
  if (/3[-_ ]*(ось|оси)?[-_ ]*(лев|л)\b/i.test(t) || /3[-_ ]*п\/?л\b/i.test(t)) return 'trailer_3_left';
  if (/3[-_ ]*(ось|оси)?[-_ ]*(прав|п)\b/i.test(t) || /3[-_ ]*п\/?п\b/i.test(t)) return 'trailer_3_right';

  return null;
}
