import { Storage, type StorageOptions } from '@google-cloud/storage';
import type { FirebaseEnv } from '../db/env.js';
import { buildStorageAuthOptions } from '../db/googleAuth.js';
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
 * ImageStore поверх Firebase Storage (GCS) через официальный @google-cloud/storage (keyless).
 * Единственное место, знающее про SDK хранилища. В domain и routes не импортируется.
 * Имя класса историческое — бакет по-прежнему Firebase Storage (FIREBASE_STORAGE_BUCKET),
 * сменился только SDK-клиент (без service-account key).
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
 * Ленивый BucketLike: клиент @google-cloud/storage и bucket создаются при ПЕРВОМ обращении
 * и кешируются на lifetime инстанса. Credentials строятся встроенной в Storage
 * google-auth-library из общего конфига (buildStorageAuthOptions) — см. заметку о версиях
 * в db/googleAuth.ts. Сеть в конструкторе gateway не трогается.
 */
function createLazyBucket(env: FirebaseEnv, bucketName: string): BucketLike {
  let bucketPromise: Promise<import('@google-cloud/storage').Bucket> | null = null;
  const getBucket = (): Promise<import('@google-cloud/storage').Bucket> => {
    if (!bucketPromise) {
      bucketPromise = (async () => {
        // Cross-version boundary: наш StorageAuthOptions → StorageOptions встроенной lib Storage.
        const options = buildStorageAuthOptions(env) as unknown as StorageOptions;
        return new Storage(options).bucket(bucketName);
      })();
    }
    return bucketPromise;
  };

  return {
    file(key: string): FileLike {
      return {
        async save(data, options) {
          return (await getBucket()).file(key).save(data, options);
        },
        async exists() {
          return (await getBucket()).file(key).exists();
        },
        async download() {
          return (await getBucket()).file(key).download();
        },
        async getMetadata() {
          const [meta] = await (await getBucket()).file(key).getMetadata();
          return [{ contentType: meta.contentType }];
        },
        async delete(options) {
          return (await getBucket()).file(key).delete(options);
        },
      };
    },
  };
}

/**
 * Фабрика реального ImageStore. Имя бакета — из аргумента или FirebaseEnv.storageBucket
 * (FIREBASE_STORAGE_BUCKET). Проверка имени идёт ДО построения клиента, чтобы явная
 * ошибка конфигурации не требовала реальных креденшелов.
 */
export function createFirebaseStorageGateway(env: FirebaseEnv, bucketName?: string): FirebaseStorageGateway {
  const name = (bucketName ?? env.storageBucket)?.trim();
  if (!name) {
    throw new ImageStoreError('Не задан бакет Firebase Storage (FIREBASE_STORAGE_BUCKET).');
  }
  return new FirebaseStorageGateway(createLazyBucket(env, name));
}
