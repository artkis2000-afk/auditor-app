import { FirestoreError } from './firestoreGateway.js';

/**
 * Устойчивость к ТРАНЗИЕНТНЫМ сбоям Firestore/gRPC (KI-27): короткий bounded retry с
 * экспоненциальным backoff. Ретраятся ТОЛЬКО безопасные (идемпотентные) операции —
 * решение принимает вызывающий (см. AdminFirestoreGateway). Здесь — чистая, тестируемая
 * без реального Firestore логика классификации ошибок и повторов.
 */

/**
 * Ретраебельные gRPC-статусы (транзиентные): DEADLINE_EXCEEDED(4), RESOURCE_EXHAUSTED(8),
 * ABORTED(10), INTERNAL(13), UNAVAILABLE(14). НЕ ретраятся: NOT_FOUND(5), PERMISSION_DENIED(7),
 * INVALID_ARGUMENT(3), ALREADY_EXISTS(6), UNAUTHENTICATED(16) и прочие детерминированные.
 */
const RETRYABLE_GRPC_CODES = new Set([4, 8, 10, 13, 14]);

function isRetryableGrpc(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'number') return RETRYABLE_GRPC_CODES.has(code);
  }
  return false;
}

/** Транзиентна ли ошибка Firestore: наш таймаут или ретраебельный gRPC-код (в т.ч. в cause). */
export function isTransientFirestoreError(err: unknown): boolean {
  if (err instanceof FirestoreError) {
    if (/timeout/i.test(err.message)) return true;
    return isRetryableGrpc(err.cause);
  }
  return isRetryableGrpc(err);
}

export interface RetryOptions {
  /** Доп. попыток после первой (итого попыток = retries+1). По умолчанию 2. */
  retries?: number;
  /** Базовая задержка backoff, мс (растёт экспоненциально). По умолчанию 200. */
  baseDelayMs?: number;
  /** Инъекция сна (для тестов — no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Предикат «ошибку можно повторить». По умолчанию — isTransientFirestoreError. */
  isRetryable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Выполняет op с ограниченным числом повторов ТОЛЬКО при транзиентной ошибке.
 * Нетранзиентная ошибка — немедленный проброс (fail-fast). Исчерпание попыток — проброс последней.
 */
export async function retryTransient<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? isTransientFirestoreError;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
