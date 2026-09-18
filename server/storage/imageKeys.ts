import { ImageStoreError } from './imageStore.js';

/** MIME → расширение файла для storage-ключа. Неизвестный тип → 'bin'. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function extensionForMime(contentType: string): string {
  return EXT_BY_MIME[contentType.toLowerCase().split(';')[0]!.trim()] ?? 'bin';
}

/**
 * Детерминированный storage-ключ оригинала накладной: invoices/{invoiceId}/original.<ext>.
 * invoiceId жёстко санитизируется (только [A-Za-z0-9_-]; точки и слэши удаляются) —
 * исключает path traversal. Наши id вида inv-<timestamp> точек не содержат.
 */
export function buildInvoiceImageKey(invoiceId: string, contentType: string): string {
  const safeId = invoiceId.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) {
    throw new ImageStoreError('Некорректный invoiceId для storage-ключа');
  }
  return `invoices/${safeId}/original.${extensionForMime(contentType)}`;
}
