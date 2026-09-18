import { getStorage } from 'firebase-admin/storage';
import type { FirebaseEnv } from '../db/env.js';
import { getAdminApp } from '../db/adminApp.js';
import { type ImageStore, type StoredImage, ImageStoreError } from './imageStore.js';

/**
 * Минимальная структурная граница вокруг GCS-бакета Firebase Admin.
 * Позволяет юнит-тестировать gateway с фейковым бакетом, не поднимая реальный Firebase.
 */
export interface FileLike {
  save(data: Buffer, options: { contentType: string; resumable?: boolean }): Promise<unknown>;
  exists(): Promise<[boolean]>;
  download(): Promise<[Buffer]>;
  getMetadata(): Promise<[{ contentType?: string }]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
}
export interface BucketLike {
  file(key: string): FileLike;
}

/**
 * ImageStore поверх Firebase Storage (GCS). Единственное место, знающее про SDK хранилища.
 * Переиспускает уже инициализированное Admin App (см. getAdminApp) — второй Firebase app не создаётся.
 * В domain и routes не импортируется.
 */
export class FirebaseStorageGateway implements ImageStore {
  constructor(private readonly bucket: BucketLike) {}

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    try {
      await this.bucket.file(key).save(data, { contentType, resumable: false });
    } catch (err) {
      throw new ImageStoreError(`Не удалось записать объект хранилища: ${key}`, err);
    }
  }

  async get(key: string): Promise<StoredImage> {
    let file: FileLike;
    try {
      file = this.bucket.file(key);
      const [exists] = await file.exists();
      if (!exists) throw new ImageStoreError(`Объект хранилища не найден: ${key}`);
    } catch (err) {
      if (err instanceof ImageStoreError) throw err;
      throw new ImageStoreError(`Ошибка доступа к объекту хранилища: ${key}`, err);
    }
    try {
      const [data] = await file.download();
      const [meta] = await file.getMetadata();
      return { data, contentType: meta.contentType ?? 'application/octet-stream' };
    } catch (err) {
      throw new ImageStoreError(`Не удалось прочитать объект хранилища: ${key}`, err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.bucket.file(key).delete({ ignoreNotFound: true });
    } catch (err) {
      throw new ImageStoreError(`Не удалось удалить объект хранилища: ${key}`, err);
    }
  }
}

/**
 * Фабрика реального ImageStore. Имя бакета — из аргумента или FirebaseEnv.storageBucket
 * (FIREBASE_STORAGE_BUCKET). Проверка имени идёт ДО обращения к Firebase, чтобы явная
 * ошибка конфигурации не требовала реальных креденшелов.
 */
export function createFirebaseStorageGateway(env: FirebaseEnv, bucketName?: string): FirebaseStorageGateway {
  const name = (bucketName ?? env.storageBucket)?.trim();
  if (!name) {
    throw new ImageStoreError('Не задан бакет Firebase Storage (FIREBASE_STORAGE_BUCKET).');
  }
  const app = getAdminApp(env);
  const bucket = getStorage(app).bucket(name) as unknown as BucketLike;
  return new FirebaseStorageGateway(bucket);
}
