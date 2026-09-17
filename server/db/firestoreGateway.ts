/**
 * Тонкая абстракция доступа к Firestore на уровне коллекций/документов.
 * Изолирует остальной код (репозитории) от конкретного SDK и делает их
 * юнит-тестируемыми (in-memory реализация в тестах).
 */

export interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}

export type BatchOp =
  | { type: 'set'; collection: string; id: string; data: Record<string, unknown> }
  | { type: 'delete'; collection: string; id: string };

export interface FirestoreGateway {
  /** Все документы коллекции. */
  getAll(collection: string): Promise<RawDoc[]>;
  /** Документ по id или null. */
  getById(collection: string, id: string): Promise<RawDoc | null>;
  /** Создать/перезаписать документ (изменяющая операция). */
  set(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** Удалить документ (изменяющая операция). */
  delete(collection: string, id: string): Promise<void>;
  /** Атомарно применить набор операций (изменяющая операция). */
  commitBatch(ops: BatchOp[]): Promise<void>;
}

/** Ошибка уровня доступа к БД — оборачивает сбои Firestore для единообразной обработки. */
export class FirestoreError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FirestoreError';
  }
}
