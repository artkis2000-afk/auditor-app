import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client';
import type { DashboardStats } from '../types';
import { Loading, ErrorState, EmptyState, StatCard } from '../components/states';

const rub = (n: number): string =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0);

export function DashboardPage(): JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .dashboardStats({ periodType: 'all' })
      .then((s) => setStats(s))
      .catch((err: unknown) => {
        // 401 обрабатывается централизованно (разлогин); прочее показываем в UI.
        if (!(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof ApiError ? err.message : 'Не удалось загрузить дашборд.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  if (loading) return <Loading label="Загрузка дашборда…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!stats) return <EmptyState title="Дашборд недоступен" />;

  const isEmpty = stats.totalInvoicesCount === 0;

  return (
    <section>
      <h1 className="page-title">Дашборд</h1>
      <p className="page-subtitle">Период: за всё время</p>

      <div className="grid grid--stats">
        <StatCard label="Всего накладных" value={stats.totalInvoicesCount} />
        <StatCard label="С аномалиями" value={stats.flaggedInvoicesCount} tone={stats.flaggedInvoicesCount > 0 ? 'warn' : 'default'} />
        <StatCard label="Доля с аномалиями" value={`${Math.round(stats.flaggedPercentage)}%`} tone={stats.flaggedPercentage > 0 ? 'warn' : 'default'} />
        <StatCard label="Потенциальная экономия" value={rub(stats.potentialSavings)} tone={stats.potentialSavings > 0 ? 'good' : 'default'} />
      </div>

      {isEmpty ? (
        <EmptyState title="Пока нет накладных" hint="Загрузите первую накладную, и здесь появится статистика." />
      ) : (
        <div className="grid grid--panels">
          <div className="card panel">
            <h2 className="panel__title">Структура накладных</h2>
            {stats.pieData.length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <ul className="legend">
                {stats.pieData.map((p) => (
                  <li key={p.name} className="legend__row">
                    <span className="legend__dot" style={{ background: p.color }} aria-hidden="true" />
                    <span className="legend__name">{p.name}</span>
                    <span className="legend__val">{p.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card panel">
            <h2 className="panel__title">Закупки по поставщикам</h2>
            {stats.supplierPurchases.length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <ul className="ranklist">
                {stats.supplierPurchases.slice(0, 8).map((s) => (
                  <li key={s.name} className="ranklist__row">
                    <span className="ranklist__name">{s.name}</span>
                    <span className="ranklist__val">{rub(s.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card panel">
            <h2 className="panel__title">Частые позиции</h2>
            {stats.topPartsData.length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <ul className="ranklist">
                {stats.topPartsData.slice(0, 8).map((t) => (
                  <li key={t.name} className="ranklist__row">
                    <span className="ranklist__name">{t.name}</span>
                    <span className="ranklist__val">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card panel">
            <h2 className="panel__title">Последние аномалии</h2>
            {stats.recentAnomalies.length === 0 ? (
              <EmptyState title="Аномалий нет" />
            ) : (
              <ul className="anomalies">
                {stats.recentAnomalies.slice(0, 6).map((a) => (
                  <li key={a.id} className={`anomalies__row anomalies__row--${a.severity}`}>
                    <div className="anomalies__head">
                      <span className="anomalies__supplier">{a.supplierName}</span>
                      <span className="anomalies__date">{a.date}</span>
                    </div>
                    <div className="anomalies__details">{a.details}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
