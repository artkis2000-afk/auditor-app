import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { FirebaseEnv } from './env.js';
import { getAdminApp } from './adminApp.js';
import { FirestoreError, type BatchOp, type FirestoreGateway, type RawDoc } from './firestoreGateway.js';
import { retryTransient } from './retry.js';

/** Таймаут на операцию Firestore, чтобы «висящий» запрос не блокировал API. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new FirestoreError(`Firestore timeout: ${label}`)), ms)),
  ]);
}

const READ_TIMEOUT = 8000;
const WRITE_TIMEOUT = 5000;

/**
 * Санитайзер под ограничения Firestore (перенос идеи из исходника):
 * убирает undefined (Firestore их не принимает) и подрезает слишком большой imagePath.
 */
function sanitize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (k === 'imagePath' && typeof v === 'string' && v.length > 500000) {
        out[k] = '/assets/invoice_placeholder.png';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Реализация FirestoreGateway поверх Firebase Admin SDK.
 * Единственное место, знающее про SDK. Ленивая инициализация приложения и БД.
 */
export class AdminFirestoreGateway implements FirestoreGateway {
  private db: Firestore;

  constructor(env: FirebaseEnv) {
    let app: App;
    try {
      app = getAdminApp(env);
    } catch (err) {
      throw new FirestoreError('Не удалось инициализировать Firebase Admin SDK', err);
    }

    try {
      this.db =
        env.databaseId && env.databaseId !== '(default)'
          ? getFirestore(app, env.databaseId)
          : getFirestore(app);
    } catch (err) {
      throw new FirestoreError('Не удалось получить экземпляр Firestore', err);
    }
  }

  // Чтения идемпотентны → безопасный bounded retry на транзиентных сбоях (KI-27).
  async getAll(collection: string): Promise<RawDoc[]> {
    return retryTransient(async () => {
      try {
        const snap = await withTimeout(this.db.collection(collection).get(), READ_TIMEOUT, `getAll ${collection}`);
        return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
      } catch (err) {
        throw err instanceof FirestoreError ? err : new FirestoreError(`Ошибка чтения коллекции ${collection}`, err);
      }
    });
  }

  async getById(collection: string, id: string): Promise<RawDoc | null> {
    return retryTransient(async () => {
      try {
        const doc = await withTimeout(this.db.collection(collection).doc(id).get(), READ_TIMEOUT, `getById ${collection}/${id}`);
        if (!doc.exists) return null;
        return { id: doc.id, data: doc.data() as Record<string, unknown> };
      } catch (err) {
        throw err instanceof FirestoreError ? err : new FirestoreError(`Ошибка чтения ${collection}/${id}`, err);
      }
    });
  }

  // set по (collection,id) идемпотентен (перезапись теми же данными) → безопасный retry.
  async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const doc = sanitize(data) as Record<string, unknown>;
    return retryTransient(async () => {
      try {
        await withTimeout(this.db.collection(collection).doc(id).set(doc), WRITE_TIMEOUT, `set ${collection}/${id}`);
      } catch (err) {
        throw err instanceof FirestoreError ? err : new FirestoreError(`Ошибка записи ${collection}/${id}`, err);
      }
    });
  }

  // delete по id идемпотентен (повторное удаление — тот же конечный результат) → безопасный retry.
  async delete(collection: string, id: string): Promise<void> {
    return retryTransient(async () => {
      try {
        await withTimeout(this.db.collection(collection).doc(id).delete(), WRITE_TIMEOUT, `delete ${collection}/${id}`);
      } catch (err) {
        throw err instanceof FirestoreError ? err : new FirestoreError(`Ошибка удаления ${collection}/${id}`, err);
      }
    });
  }

  /**
   * НЕ ретраится автоматически (fail-fast): атомарный батч + клиентский таймаут дают
   * неоднозначность «успел ли коммит примениться на сервере». Хотя текущие батчи состоят
   * только из идемпотентных по id set/delete, гейтвей — общий слой и не может доказать
   * идемпотентность произвольного будущего батча. Повтор оставляем на усмотрение вызывающего.
   */
  async commitBatch(ops: BatchOp[]): Promise<void> {
    if (ops.length === 0) return;
    try {
      const batch = this.db.batch();
      for (const op of ops) {
        const ref = this.db.collection(op.collection).doc(op.id);
        if (op.type === 'set') {
          batch.set(ref, sanitize(op.data) as Record<string, unknown>);
        } else {
          batch.delete(ref);
        }
      }
      await withTimeout(batch.commit(), WRITE_TIMEOUT, `commitBatch (${ops.length} ops)`);
    } catch (err) {
      throw err instanceof FirestoreError ? err : new FirestoreError('Ошибка пакетной записи в Firestore', err);
    }
  }
}
