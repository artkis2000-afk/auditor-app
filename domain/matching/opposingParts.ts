/**
 * Определение «противоположных» деталей (лев/прав, перед/зад, верх/низ, внутр/внешн).
 * Дословный перенос areOpposingParts из исходного serverDb.ts. Используется, чтобы
 * не сопоставлять, например, «левый» с «правым» и не считать их дубликатами.
 */
export function areOpposingParts(s1: string, s2: string): boolean {
  const clean1 = s1.toLowerCase();
  const clean2 = s2.toLowerCase();

  const exactOpposingPairs = [
    ['передний', 'задний', 'средний'],
    ['передняя', 'задняя', 'средняя'],
    ['переднее', 'заднее', 'среднее'],
    ['левый', 'правый'],
    ['левая', 'правая'],
    ['левое', 'правое'],
    ['верхний', 'нижний'],
    ['верхняя', 'нижняя'],
    ['внутренний', 'наружный', 'внешний'],
    ['внутренняя', 'наружная', 'внешняя'],
  ];

  for (const list of exactOpposingPairs) {
    const present1 = list.filter((word) => clean1.includes(word));
    const present2 = list.filter((word) => clean2.includes(word));
    if (present1.length === 1 && present2.length === 1 && present1[0] !== present2[0]) {
      return true;
    }
  }

  const opposingPairs = [
    { a: ['передн', 'front'], b: ['задн', 'rear', 'back'] },
    { a: ['лев', 'left'], b: ['прав', 'right'] },
    { a: ['верхн', 'upper', 'top'], b: ['нижн', 'lower', 'bottom'] },
    { a: ['внутрен', 'inner', 'internal'], b: ['внешн', 'наружн', 'outer', 'external'] },
  ];

  for (const pair of opposingPairs) {
    const hasA1 = pair.a.some((w) => clean1.includes(w));
    const hasB1 = pair.b.some((w) => clean1.includes(w));
    const hasA2 = pair.a.some((w) => clean2.includes(w));
    const hasB2 = pair.b.some((w) => clean2.includes(w));

    if (hasA1 && !hasB1 && hasB2 && !hasA2) {
      return true;
    }
    if (hasB1 && !hasA1 && hasA2 && !hasB2) {
      return true;
    }
  }

  return false;
}
