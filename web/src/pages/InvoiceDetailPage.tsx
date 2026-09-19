import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { InvoiceDetail, Vehicle } from '../types';
import { useAuth } from '../auth/AuthContext';
import { perms } from '../auth/permissions';
import { rub, num, fmtDate, statusMeta, flagTypeLabel, severityMeta, placementLabel } from '../lib/format';
import { Badge, Modal } from '../components/ui';
import { Loading, ErrorState } from '../components/states';
import { ImagePreview } from '../components/ImagePreview';

export function InvoiceDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'ocr' | 'confirm' | 'delete' | 'approve'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ocrTried = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.invoiceDetail(id), api.vehiclesList().catch(() => [] as Vehicle[])])
      .then(([d, vs]) => {
        setDetail(d);
        setVehicles(Object.fromEntries(vs.map((v) => [v.id, v.name])));
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof ApiError ? err.message : 'Не удалось загрузить накладную.');
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  const runOcr = useCallback(async () => {
    setBusy('ocr');
    setActionError(null);
    try {
      const r = await api.invoiceOcr(id);
      setNotice(r.fallback ? 'Распознавание выполнено в резервном режиме.' : 'Распознавание завершено.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось распознать накладную.');
    } finally {
      setBusy(null);
      load(); // отражаем актуальное состояние backend (confirmed/flagged или draft+ocrError)
    }
  }, [id, load]);

  // Авто-OCR один раз, если накладная только что загружена (status=processing) И роль имеет право
  // на OCR (admin|manager). Иначе (viewer) не дёргаем недоступный endpoint — показываем «ожидает».
  // ocrTried (useRef) переживает двойной вызов эффекта в StrictMode → повторного авто-OCR нет.
  const mayOcr = perms.canReOcr(user);
  useEffect(() => {
    if (detail && detail.invoice.status === 'processing' && mayOcr && !ocrTried.current && busy === null) {
      ocrTried.current = true;
      void runOcr();
    }
  }, [detail, busy, runOcr, mayOcr]);

  const activeFlags = useMemo(() => (detail?.flags ?? []).filter((f) => !f.isResolved), [detail]);
  const itemName = useCallback(
    (itemId: string) => detail?.items.find((i) => i.id === itemId)?.rawName ?? itemId,
    [detail],
  );

  async function doConfirm(): Promise<void> {
    setConfirmOpen(false);
    setBusy('confirm');
    setActionError(null);
    try {
      const r = await api.invoiceConfirm(id);
      setNotice(r.status === 'flagged' ? 'Накладная подтверждена, но остаются аномалии.' : 'Накладная подтверждена.');
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось подтвердить накладную.');
    } finally {
      setBusy(null);
    }
  }

  async function doApproveAll(): Promise<void> {
    setBusy('approve');
    setActionError(null);
    try {
      await api.invoiceApproveAllFlags(id);
      setNotice('Аномалии одобрены.');
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось одобрить аномалии.');
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(): Promise<void> {
    if (!window.confirm('Удалить накладную? Действие можно будет откатить только через журнал.')) return;
    setBusy('delete');
    setActionError(null);
    try {
      await api.invoiceDelete(id);
      navigate('/invoices');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось удалить накладную.');
      setBusy(null);
    }
  }

  if (loading) return <Loading label="Загрузка накладной…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return <ErrorState message="Накладная не найдена." onRetry={() => navigate('/invoices')} />;

  const inv = detail.invoice;
  const st = statusMeta(inv.status);
  const processing = inv.status === 'processing' || busy === 'ocr';

  return (
    <section className="detail">
      <button type="button" className="btn btn--ghost btn--auto" onClick={() => navigate(-1)}>
        ← Назад к списку
      </button>

      <div className="detail__head card">
        <div className="detail__headmain">
          <h1 className="page-title">{inv.filename || `Накладная ${inv.id}`}</h1>
          <div className="detail__meta">
            <Badge label={st.label} tone={st.tone} />
            {inv.ocrFallback ? <Badge label="Резервный OCR" tone="info" /> : null}
            {activeFlags.length > 0 ? <Badge label={`Аномалий: ${activeFlags.length}`} tone="danger" /> : null}
          </div>
        </div>
        <div className="detail__actions">
          {perms.canReOcr(user) ? (
            <button type="button" className="btn" onClick={runOcr} disabled={busy !== null || processing}>
              {busy === 'ocr' ? 'Распознавание…' : 'Повторить OCR'}
            </button>
          ) : null}
          {perms.canConfirm(user) ? (
            <button type="button" className="btn btn--primary" onClick={() => setConfirmOpen(true)} disabled={busy !== null || processing || inv.status === 'confirmed'}>
              Подтвердить
            </button>
          ) : null}
          {perms.canDelete(user) ? (
            <button type="button" className="btn btn--danger" onClick={doDelete} disabled={busy !== null}>
              Удалить
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <div className="banner banner--info">{notice}</div> : null}
      {actionError ? <div className="banner banner--error" role="alert">{actionError}</div> : null}
      {processing ? (
        <div className="banner banner--info">
          {mayOcr
            ? 'Идёт распознавание накладной… Это может занять несколько секунд.'
            : 'Накладная ожидает обработки. Повторное распознавание может запустить администратор.'}
        </div>
      ) : null}
      {inv.ocrError ? <div className="banner banner--warn">Ошибка распознавания: {inv.ocrError}</div> : null}

      <div className="detail__grid">
        <div className="card panel">
          <h2 className="panel__title">Данные накладной</h2>
          <dl className="kv">
            <dt>Дата</dt><dd>{fmtDate(inv.recognizedDate)}</dd>
            <dt>Поставщик</dt><dd>{detail.supplierName || inv.rawSupplierName || '—'}</dd>
            <dt>Итого</dt><dd>{rub(inv.totalSum)}</dd>
            <dt>Позиций</dt><dd>{num(detail.items.length)}</dd>
            <dt>Загрузил</dt><dd>{detail.uploaderName || '—'}</dd>
            {inv.comment ? (<><dt>Комментарий</dt><dd>{inv.comment}</dd></>) : null}
          </dl>
        </div>

        <div className="card panel">
          <h2 className="panel__title">Изображение</h2>
          <ImagePreview invoiceId={inv.id} />
        </div>
      </div>

      <div className="card panel">
        <h2 className="panel__title">Позиции ({detail.items.length})</h2>
        {detail.items.length === 0 ? (
          <p className="muted">Позиции не распознаны.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--items">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th className="ta-r">Кол-во</th>
                  <th className="ta-r">Цена</th>
                  <th className="ta-r">Сумма</th>
                  <th>Сопоставление</th>
                  <th>ТС / размещение</th>
                  <th>Аномалия</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => {
                  const matchedName = it.matchedNomenclatureId
                    ? it.suggestions.find((s) => s.nomenclatureId === it.matchedNomenclatureId)?.name
                    : undefined;
                  const hasFlag = (detail.flags ?? []).some((f) => f.invoiceItemId === it.id && !f.isResolved);
                  return (
                    <tr key={it.id}>
                      <td className="cell-raw">{it.rawName}</td>
                      <td className="ta-r">{num(it.quantity)}</td>
                      <td className="ta-r">{rub(it.unitPrice)}</td>
                      <td className="ta-r">{rub(it.lineSum)}</td>
                      <td>
                        {it.matchedNomenclatureId ? (
                          <Badge label={matchedName ? matchedName : 'Сопоставлено'} tone="good" />
                        ) : (
                          <Badge label="Не сопоставлено" tone="warn" />
                        )}
                      </td>
                      <td>
                        {it.vehicleId ? (vehicles[it.vehicleId] ?? it.vehicleId) : '—'}
                        {it.truckPlacement && it.truckPlacement !== 'none' ? ` · ${placementLabel(it.truckPlacement)}` : ''}
                      </td>
                      <td>{hasFlag ? <Badge label="Есть" tone="danger" /> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint-note">Цена — печатная «Цена» до скидки; Сумма — итог строки после скидки (данные backend, без пересчёта).</p>
      </div>

      <div className="card panel">
        <div className="panel__titlerow">
          <h2 className="panel__title">Аномалии ({detail.flags.length})</h2>
          {activeFlags.length > 0 && perms.canApproveAnomaly(user) ? (
            <button type="button" className="btn btn--auto" onClick={doApproveAll} disabled={busy !== null}>
              {busy === 'approve' ? 'Одобрение…' : 'Одобрить все'}
            </button>
          ) : null}
        </div>
        {detail.flags.length === 0 ? (
          <p className="muted">Аномалий не обнаружено.</p>
        ) : (
          <ul className="flags">
            {detail.flags.map((f) => {
              const sev = severityMeta(f.severity);
              return (
                <li key={f.id} className={`flags__row ${f.isResolved ? 'flags__row--resolved' : ''}`}>
                  <div className="flags__head">
                    <span className="flags__type">{flagTypeLabel(f.flagType)}</span>
                    <Badge label={sev.label} tone={sev.tone} />
                    {f.isResolved ? <Badge label="Одобрено" tone="good" /> : null}
                  </div>
                  <div className="flags__details">{f.details}</div>
                  <div className="flags__item">Позиция: {itemName(f.invoiceItemId)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmOpen ? (
        <Modal title="Подтверждение накладной" onClose={() => setConfirmOpen(false)}>
          <div className="confirmbox">
            <p>Будет подтверждена накладная:</p>
            <ul className="confirmbox__list">
              <li>Поставщик: <b>{detail.supplierName || '—'}</b></li>
              <li>Дата: <b>{fmtDate(inv.recognizedDate)}</b></li>
              <li>Итого: <b>{rub(inv.totalSum)}</b></li>
              <li>Позиций: <b>{detail.items.length}</b></li>
            </ul>
            {activeFlags.length > 0 ? (
              <p className="banner banner--warn">Внимание: активных аномалий — {activeFlags.length}. Подтверждение допустимо, они останутся в журнале.</p>
            ) : null}
            <div className="upload__actions">
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>Отмена</button>
              <button type="button" className="btn btn--primary" onClick={doConfirm}>Подтвердить</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
