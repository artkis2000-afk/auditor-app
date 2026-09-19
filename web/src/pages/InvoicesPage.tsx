import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { InvoiceListEntry, Vehicle, InvoiceStatus } from '../types';
import { useAuth } from '../auth/AuthContext';
import { perms } from '../auth/permissions';
import { rub, num, fmtDate, statusMeta } from '../lib/format';
import { Badge } from '../components/ui';
import { Loading, ErrorState, EmptyState } from '../components/states';
import { UploadModal } from '../components/UploadModal';

const STATUS_OPTIONS: { value: '' | InvoiceStatus; label: string }[] = [
  { value: '', label: 'Все статусы' },
  { value: 'processing', label: 'Распознаётся' },
  { value: 'draft', label: 'Черновик' },
  { value: 'flagged', label: 'Есть аномалии' },
  { value: 'confirmed', label: 'Подтверждена' },
  { value: 'archived', label: 'В архиве' },
];

export function InvoicesPage(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const search = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as '' | InvoiceStatus;
  const onlyAnomalies = params.get('anomalies') === '1';

  const [rows, setRows] = useState<InvoiceListEntry[] | null>(null);
  const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.invoicesList(status ? { status } : {}),
      api.vehiclesList().catch(() => [] as Vehicle[]),
    ])
      .then(([list, vs]) => {
        setRows(list);
        setVehicles(Object.fromEntries(vs.map((v) => [v.id, v.name])));
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof ApiError ? err.message : 'Не удалось загрузить накладные.');
        }
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyAnomalies && r.flagsCount <= 0) return false;
      if (!q) return true;
      return (
        (r.supplierName ?? '').toLowerCase().includes(q) ||
        (r.filename ?? '').toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, search, onlyAnomalies]);

  const vehicleOf = useCallback(
    (r: InvoiceListEntry): string => {
      const ids = Array.from(new Set((r.items ?? []).map((i) => i.vehicleId).filter((v): v is string => !!v)));
      if (ids.length === 0) return '—';
      const names = ids.map((id) => vehicles[id] ?? id);
      return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
    },
    [vehicles],
  );

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Накладные</h1>
          <p className="page-subtitle">{rows ? `${filtered.length} из ${rows.length}` : ''}</p>
        </div>
        {perms.canUpload(user) ? (
          <button type="button" className="btn btn--primary btn--auto" onClick={() => setUploadOpen(true)}>
            + Новая накладная
          </button>
        ) : null}
      </div>

      <div className="toolbar">
        <input
          className="field__input toolbar__search"
          type="search"
          placeholder="Поиск: поставщик, файл, id…"
          value={search}
          onChange={(e) => setParam('q', e.target.value)}
        />
        <select className="field__input toolbar__select" value={status} onChange={(e) => setParam('status', e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="toolbar__check">
          <input type="checkbox" checked={onlyAnomalies} onChange={(e) => setParam('anomalies', e.target.checked ? '1' : '')} />
          Только с аномалиями
        </label>
      </div>

      {loading ? (
        <Loading label="Загрузка накладных…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows && rows.length > 0 ? 'Ничего не найдено' : 'Накладных пока нет'}
          hint={rows && rows.length > 0 ? 'Измените поиск или фильтры.' : 'Нажмите «Новая накладная», чтобы загрузить первую.'}
        />
      ) : (
        <>
          {/* desktop table */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Накладная</th>
                  <th>Поставщик</th>
                  <th>ТС</th>
                  <th className="ta-r">Сумма</th>
                  <th className="ta-r">Позиций</th>
                  <th>Статус</th>
                  <th>Аномалии</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const st = statusMeta(r.status);
                  return (
                    <tr key={r.id} className={`row row--${st.tone}`} onClick={() => navigate(`/invoices/${r.id}`)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/invoices/${r.id}`); }}>
                      <td>{fmtDate(r.recognizedDate)}</td>
                      <td className="cell-strong">{r.filename || r.id}</td>
                      <td>{r.supplierName || '—'}</td>
                      <td>{vehicleOf(r)}</td>
                      <td className="ta-r">{rub(r.totalSum)}</td>
                      <td className="ta-r">{num(r.items?.length ?? 0)}</td>
                      <td><Badge label={st.label} tone={st.tone} /></td>
                      <td>{r.flagsCount > 0 ? <Badge label={`${r.flagsCount}`} tone="danger" /> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <div className="cards">
            {filtered.map((r) => {
              const st = statusMeta(r.status);
              return (
                <button type="button" key={r.id} className={`card inv-card inv-card--${st.tone}`} onClick={() => navigate(`/invoices/${r.id}`)}>
                  <div className="inv-card__top">
                    <span className="cell-strong">{r.filename || r.id}</span>
                    <Badge label={st.label} tone={st.tone} />
                  </div>
                  <div className="inv-card__mid">{r.supplierName || '—'} · {fmtDate(r.recognizedDate)}</div>
                  <div className="inv-card__bot">
                    <span>{rub(r.totalSum)}</span>
                    <span>{num(r.items?.length ?? 0)} поз.</span>
                    {r.flagsCount > 0 ? <Badge label={`${r.flagsCount} аном.`} tone="danger" /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {uploadOpen ? (
        <UploadModal onClose={() => setUploadOpen(false)} onCreated={(id) => { setUploadOpen(false); navigate(`/invoices/${id}`); }} />
      ) : null}
    </section>
  );
}
