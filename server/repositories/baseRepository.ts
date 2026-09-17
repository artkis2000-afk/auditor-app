import type { z } from 'zod';
import type { FirestoreGateway, RawDoc } from '../db/firestoreGateway.js';

/** Ошибка репозитория (например, документ не проходит Zod-валидацию). */
export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/**
 * Базовый репозиторий: CRUD над одной коллекцией с Zod-валидацией на чтении.
 * docId = entity.id. Документ приводится к типу схемой (недостающие поля → дефолты схемы).
 */
export class FirestoreRepository<T extends { id: string }> {
  constructor(
    protected readonly gateway: FirestoreGateway,
    readonly collection: string,
    // Вход схемы — unknown (сырой документ Firestore), выход — T. Так схемы с .default() совместимы.
    protected readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ) {}

  protected map(doc: RawDoc): T {
    const res = this.schema.safeParse({ ...doc.data, id: doc.id });
    if (!res.success) {
      throw new RepositoryError(
        `Некорректный документ ${this.collection}/${doc.id}: ${res.error.issues.map((i) => i.message).join('; ')}`,
        res.error,
      );
    }
    return res.data;
  }

  async getAll(): Promise<T[]> {
    const docs = await this.gateway.getAll(this.collection);
    return docs.map((d) => this.map(d));
  }

  async getById(id: string): Promise<T | null> {
    const doc = await this.gateway.getById(this.collection, id);
    return doc ? this.map(doc) : null;
  }

  /** Создание/обновление (изменяющая операция). */
  async upsert(entity: T): Promise<void> {
    await this.gateway.set(this.collection, entity.id, entity as unknown as Record<string, unknown>);
  }

  /** Жёсткое удаление документа (изменяющая операция). */
  async delete(id: string): Promise<void> {
    await this.gateway.delete(this.collection, id);
  }
}
