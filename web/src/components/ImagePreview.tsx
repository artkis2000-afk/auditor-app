import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Modal } from './ui';

/** Превью оригинала накладной: тянет приватный объект как Blob (с Bearer) → object URL. */
export function ImagePreview({ invoiceId }: { invoiceId: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setState('loading');
    api
      .invoiceImageBlob(invoiceId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState('ok');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 (нет изображения) и прочее — показываем нейтральную заглушку.
        setState('error');
        void (err instanceof ApiError);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoiceId]);

  if (state === 'loading') return <div className="imgbox imgbox--placeholder">Загрузка изображения…</div>;
  if (state === 'error' || !url) return <div className="imgbox imgbox--placeholder">Изображение недоступно</div>;

  return (
    <>
      <button type="button" className="imgbox" onClick={() => setZoom(true)} aria-label="Открыть изображение">
        <img className="imgbox__thumb" src={url} alt="Накладная" />
        <span className="imgbox__hint">Нажмите, чтобы увеличить</span>
      </button>
      {zoom ? (
        <Modal title="Изображение накладной" onClose={() => setZoom(false)} wide>
          <img className="imgfull" src={url} alt="Накладная (крупно)" />
        </Modal>
      ) : null}
    </>
  );
}
