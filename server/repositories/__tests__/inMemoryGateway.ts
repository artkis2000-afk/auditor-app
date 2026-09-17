import type { BatchOp, FirestoreGateway, RawDoc } from '../../db/firestoreGateway.js';

/**
 * In-memory реализация FirestoreGateway для юнит-тестов репозиториев.
 * Хранит данные так же, как Firestore (doc.data() включает поле id).
 */
export class InMemoryGateway implements FirestoreGateway {
  private store = new Map<string, Map<string, Record<string, unknown>>>();

  constructor(seed?: Record<string, Array<{ id: string } & Record<string, unknown>>>) {
    if (seed) {
      for (const [collection, docs] of Object.entries(seed)) {
        const m = new Map<string, Record<string, unknown>>();
        for (const d of docs) m.set(d.id, { ...d });
        this.store.set(collection, m);
      }
    }
  }

  private col(name: string): Map<string, Record<string, unknown>> {
    let m = this.store.get(name);
    if (!m) {
      m = new Map();
      this.store.set(name, m);
    }
    return m;
  }

  async getAll(collection: string): Promise<RawDoc[]> {
    return [...this.col(collection).entries()].map(([id, data]) => ({ id, data }));
  }

  async getById(collection: string, id: string): Promise<RawDoc | null> {
    const data = this.col(collection).get(id);
    return data ? { id, data } : null;
  }

  async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.col(collection).set(id, data);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.col(collection).delete(id);
  }

  async commitBatch(ops: BatchOp[]): Promise<void> {
    for (const op of ops) {
      if (op.type === 'set') this.col(op.collection).set(op.id, op.data);
      else this.col(op.collection).delete(op.id);
    }
  }

  /** Тестовый помощник: сырые документы коллекции. */
  raw(collection: string): Record<string, unknown>[] {
    return [...this.col(collection).values()];
  }
}
