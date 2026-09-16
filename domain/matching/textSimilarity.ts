/**
 * Нечёткое сравнение строк — дословный перенос из исходного serverDb.ts
 * (LevenshteinDistance + getStringSimilarity). Поведение сохранено 1:1.
 */

/** Расстояние Левенштейна. Строки приводятся к нижнему регистру и обрезаются. */
export function levenshteinDistance(s1: string, s2: string): number {
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // замена
          matrix[i]![j - 1]! + 1, // вставка
          matrix[i - 1]![j]! + 1, // удаление
        );
      }
    }
  }
  return matrix[b.length]![a.length]!;
}

/**
 * Схожесть строк 0.0..1.0.
 * ВНИМАНИЕ (перенос как есть): maxLength берётся по ИСХОДНЫМ длинам s1/s2
 * (без trim/lowercase), тогда как расстояние — по обрезанным. Так в оригинале.
 */
export function getStringSimilarity(s1: string, s2: string): number {
  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 1.0;
  return 1.0 - distance / maxLength;
}
