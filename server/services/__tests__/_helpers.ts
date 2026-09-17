import type { Clock, IdGenerator } from '../context.js';

/** Часы с возрастающим временем (для проверки сортировки/детерминизма). */
export function countingClock(start = 0): Clock {
  let t = start;
  return {
    now: () => {
      const s = String(t++).padStart(2, '0');
      return `2026-09-17T00:00:${s}.000Z`;
    },
  };
}

/** Фиксированные часы. */
export function fixedClock(value = '2026-09-17T00:00:00.000Z'): Clock {
  return { now: () => value };
}

/** Детерминированный генератор id (prefix-1, prefix-2, ...). */
export function countingIds(): IdGenerator {
  let n = 0;
  return { generate: (prefix) => `${prefix}-${++n}` };
}

export const TS = '2026-06-01T12:00:00.000Z';
