import type { ReactNode } from 'react';

export function Loading({ label = 'Загрузка…' }: { label?: string }): JSX.Element {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title = 'Нет данных', hint }: { title?: string; hint?: string }): JSX.Element {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {hint ? <p className="state__hint">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">Ошибка</p>
      <p className="state__hint">{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: ReactNode; tone?: 'default' | 'warn' | 'good' }): JSX.Element {
  return (
    <div className={`card stat stat--${tone ?? 'default'}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
