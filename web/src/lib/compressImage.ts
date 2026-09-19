/**
 * Клиентское сжатие изображения накладной в JPEG перед отправкой на backend.
 * Цель ~2.6 МБ (запас к backend-лимиту 3 МБ, KI-23). Сначала снижаем quality на полном
 * разрешении, затем при необходимости уменьшаем разрешение. Если <3 МБ добиться нельзя — ошибка.
 * Никакого base64 в Firestore: backend сам кладёт оригинал в Storage.
 */
const MB = 1024 * 1024;
const TARGET_BYTES = 2.6 * MB; // желаемый потолок
const HARD_MAX_BYTES = 3 * MB - 64 * 1024; // строго ниже backend-guard (3 МБ)
const SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
const QUALITIES = [0.92, 0.85, 0.8, 0.75, 0.7];
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export class CompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompressionError';
  }
}

export interface CompressResult {
  base64: string; // без data:-префикса
  type: 'image/jpeg';
  bytes: number; // размер сжатого JPEG
  width: number;
  height: number;
  originalBytes: number;
  originalType: string;
}

/** Валидация выбранного файла до сжатия. Возвращает текст ошибки или null. */
export function validateImageFile(file: File): string | null {
  if (!file.type || !file.type.startsWith('image/')) return 'Выберите файл изображения (JPEG/PNG).';
  if (file.type && !ALLOWED.has(file.type.toLowerCase())) {
    return 'Неподдерживаемый формат. Используйте JPEG или PNG.';
  }
  if (file.size > 40 * MB) return 'Файл слишком большой (> 40 МБ). Выберите фото меньшего размера.';
  if (file.size === 0) return 'Файл пуст.';
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new CompressionError('Не удалось прочитать изображение.'));
    };
    img.src = url;
  });
}

function toBlob(img: HTMLImageElement, w: number, h: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(new CompressionError('Не удалось закодировать изображение.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file: File): Promise<CompressResult> {
  const invalid = validateImageFile(file);
  if (invalid) throw new CompressionError(invalid);

  const img = await loadImage(file);
  let best: { blob: Blob; w: number; h: number } | null = null;

  for (const scale of SCALES) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    for (const q of QUALITIES) {
      const blob = await toBlob(img, w, h, q);
      if (!blob) throw new CompressionError('Браузер не поддерживает обработку изображений (canvas).');
      if (blob.size <= TARGET_BYTES) {
        return finalize(blob, w, h, file);
      }
      if (blob.size <= HARD_MAX_BYTES && (!best || blob.size < best.blob.size)) {
        best = { blob, w, h };
      }
    }
  }

  if (best) return finalize(best.blob, best.w, best.h, file);
  throw new CompressionError('Не удалось сжать изображение до допустимого размера (< 3 МБ). Попробуйте другое фото.');
}

async function finalize(blob: Blob, width: number, height: number, file: File): Promise<CompressResult> {
  return {
    base64: await blobToBase64(blob),
    type: 'image/jpeg',
    bytes: blob.size,
    width,
    height,
    originalBytes: file.size,
    originalType: file.type,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}
