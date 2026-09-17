import type { FinanceItem, PeriodFilter } from './types.js';

/**
 * Разбор даты в {year, month}. Дословный перенос parseDateParts из FleetFinanceView.tsx.
 * Поддержка форматов YYYY-MM-DD, YYYY.MM.DD, DD.MM.YYYY. Дефолт {2026, 7} сохранён как в оригинале.
 */
export function parseDateParts(rawDate: string | undefined | null): { year: number; month: number } {
  if (!rawDate) return { year: 2026, month: 7 };
  const s = String(rawDate).trim();

  if (s.includes('-')) {
    const parts = s.split('-');
    const year = parseInt(parts[0] ?? '', 10) || 2026;
    const month = parseInt(parts[1] ?? '', 10) || 7;
    return { year, month };
  }

  if (s.includes('.')) {
    const parts = s.split('.');
    if ((parts[0] ?? '').length === 4) {
      return {
        year: parseInt(parts[0] ?? '', 10) || 2026,
        month: parseInt(parts[1] ?? '', 10) || 7,
      };
    } else {
      return {
        year: parseInt(parts[2] ?? '', 10) || 2026,
        month: parseInt(parts[1] ?? '', 10) || 7,
      };
    }
  }

  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
  } catch {
    // игнорируем — вернём дефолт
  }
  return { year: 2026, month: 7 };
}

/**
 * Попадает ли позиция в выбранный период. Дословный перенос isItemInPeriod из FleetFinanceView.tsx.
 */
export function isItemInPeriod(item: FinanceItem, period: PeriodFilter): boolean {
  const { periodType, selectedYear, selectedQuarter, selectedMonth, startDate, endDate } = period;
  if (periodType === 'all') return true;

  const rawDate = item.recognizedDate;

  if (periodType === 'custom') {
    if (!rawDate) return true;
    const itemTime = new Date(rawDate).getTime();
    if (startDate) {
      const startTime = new Date(startDate).getTime();
      if (itemTime < startTime) return false;
    }
    if (endDate) {
      const endTime = new Date(endDate + 'T23:59:59').getTime();
      if (itemTime > endTime) return false;
    }
    return true;
  }

  const { year: itemYear, month: itemMonth } = parseDateParts(rawDate);

  if (itemYear !== selectedYear) return false;

  if (periodType === 'year') {
    return true;
  }
  if (periodType === 'quarter') {
    const q = Math.ceil(itemMonth / 3);
    return q === selectedQuarter;
  }
  if (periodType === 'month') {
    return itemMonth === selectedMonth;
  }

  return true;
}
