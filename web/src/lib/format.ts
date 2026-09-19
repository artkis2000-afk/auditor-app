import type { InvoiceStatus, AnomalyFlagType, AnomalySeverity } from '../types';

export const rub = (n: number): string =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(n || 0);

export const num = (n: number): string => new Intl.NumberFormat('ru-RU').format(n || 0);

/** Дата OCR (обычно 'YYYY-MM-DD') или ISO → 'дд.мм.гггг'. Пустое/битое → '—'. */
export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ru-RU');
}

export type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info';

export function statusMeta(status: InvoiceStatus | string): { label: string; tone: Tone } {
  switch (status) {
    case 'confirmed':
      return { label: 'Подтверждена', tone: 'good' };
    case 'flagged':
      return { label: 'Есть аномалии', tone: 'warn' };
    case 'processing':
      return { label: 'Распознаётся', tone: 'info' };
    case 'draft':
      return { label: 'Черновик', tone: 'neutral' };
    case 'archived':
      return { label: 'В архиве', tone: 'neutral' };
    default:
      return { label: String(status), tone: 'neutral' };
  }
}

export function flagTypeLabel(type: AnomalyFlagType | string): string {
  switch (type) {
    case 'duplicate_exceed':
      return 'Повторная закупка';
    case 'price_anomaly':
      return 'Ценовая аномалия';
    case 'suspicious_supplier':
      return 'Подозрительный поставщик';
    default:
      return String(type);
  }
}

const PLACEMENT_RU: Record<string, string> = {
  cabin: 'Кабина',
  steering_left: 'Рулевая, левая',
  steering_right: 'Рулевая, правая',
  driving_left_outer: 'Ведущая, лев. наруж.',
  driving_left_inner: 'Ведущая, лев. внутр.',
  driving_right_outer: 'Ведущая, прав. наруж.',
  driving_right_inner: 'Ведущая, прав. внутр.',
  trailer_body: 'Прицеп (кузов)',
  tractor_frame: 'Тягач (рама)',
  axle_driving: 'Ведущая ось',
  axle_steering: 'Рулевая ось',
  none: '—',
};

/** Русский лейбл размещения; неизвестное значение — как есть. */
export function placementLabel(p?: string | null): string {
  if (!p) return '—';
  return PLACEMENT_RU[p] ?? p;
}

export function severityMeta(s: AnomalySeverity | string): { label: string; tone: Tone } {
  switch (s) {
    case 'high':
      return { label: 'Высокая', tone: 'danger' };
    case 'medium':
      return { label: 'Средняя', tone: 'warn' };
    case 'low':
      return { label: 'Низкая', tone: 'info' };
    default:
      return { label: String(s), tone: 'neutral' };
  }
}
