import { type ImageStore, type StoredImage, ImageStoreError } from '../imageStore.js';

/** In-memory ImageStore для тестов (без реального Firebase). */
export class InMemoryImageStore implements ImageStore {
  private readonly map = new Map<string, StoredImage>();

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    this.map.set(key, { data, contentType });
  }

  async get(key: string): Promise<StoredImage> {
    const v = this.map.get(key);
    if (!v) throw new ImageStoreError(`Объект хранилища не найден: ${key}`);
    return v;
  }

  /** Тестовый помощник: количество объектов. */
  size(): number {
    return this.map.size;
  }
}
