/**
 * Абстракция объектного хранилища изображений накладных (infra-слой).
 * НЕ знает про Firestore, Gemini, HTTP или бизнес-логику.
 *
 * Интерфейс минимален под MVP: put/get + delete (нужен для compensation при сбое
 * Firestore-записи после успешного put). exists/lifecycle/TTL/retention отложены (KI-20).
 */
export interface StoredImage {
  data: Buffer;
  /** MIME-тип объекта, например image/jpeg. */
  contentType: string;
}

export interface ImageStore {
  /** Записать (или перезаписать) объект по ключу. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Прочитать объект. Если объекта нет — бросает ImageStoreError. */
  get(key: string): Promise<StoredImage>;
  /** Удалить объект (для compensation). Идемпотентно: отсутствие объекта — не ошибка. */
  delete(key: string): Promise<void>;
}

/** Граница ошибок хранилища. Не содержит секретов/креденшелов. */
export class ImageStoreError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ImageStoreError';
  }
}
