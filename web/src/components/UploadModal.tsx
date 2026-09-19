import { useState, useRef } from 'react';
import { Modal } from './ui';
import { compressImage, validateImageFile, formatBytes, CompressionError, type CompressResult } from '../lib/compressImage';
import { api, ApiError } from '../api/client';

type Stage = 'idle' | 'compressing' | 'uploading' | 'error';

export function UploadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (invoiceId: string) => void }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [compressed, setCompressed] = useState<CompressResult | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = stage === 'compressing' || stage === 'uploading';

  function pick(f: File | null): void {
    setError(null);
    setCompressed(null);
    if (!f) {
      setFile(null);
      return;
    }
    const invalid = validateImageFile(f);
    if (invalid) {
      setFile(null);
      setError(invalid);
      return;
    }
    setFile(f);
  }

  async function submit(): Promise<void> {
    if (!file) return;
    setError(null);
    try {
      setStage('compressing');
      const result = await compressImage(file);
      setCompressed(result);

      setStage('uploading');
      const res = await api.invoiceUpload({ name: file.name, type: result.type, base64: result.base64 });
      onCreated(res.invoiceId); // навигация на detail; OCR запустится там
    } catch (err) {
      setStage('error');
      if (err instanceof CompressionError) setError(err.message);
      else if (err instanceof ApiError) setError(err.message);
      else setError('Не удалось загрузить накладную. Попробуйте снова.');
    }
  }

  return (
    <Modal title="Новая накладная" onClose={busy ? () => undefined : onClose}>
      <div className="upload">
        <input
          ref={inputRef}
          className="upload__input"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="upload__info">
            <div className="upload__row">
              <span>Файл</span>
              <span className="upload__name">{file.name}</span>
            </div>
            <div className="upload__row">
              <span>Исходный размер</span>
              <span>{formatBytes(file.size)}</span>
            </div>
            {compressed ? (
              <div className="upload__row">
                <span>После сжатия</span>
                <span>
                  {formatBytes(compressed.bytes)} · {compressed.width}×{compressed.height}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="upload__hint">Выберите фото или скан накладной. Крупное фото будет автоматически сжато до &lt; 3 МБ.</p>
        )}

        {stage === 'compressing' ? <p className="upload__status">Сжатие изображения…</p> : null}
        {stage === 'uploading' ? <p className="upload__status">Загрузка и распознавание…</p> : null}
        {error ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="upload__actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!file || busy}>
            {stage === 'compressing' ? 'Сжатие…' : stage === 'uploading' ? 'Загрузка…' : 'Загрузить и распознать'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
