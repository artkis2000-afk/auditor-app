import { describe, it, expect, vi } from 'vitest';
import { retryTransient, isTransientFirestoreError } from '../retry.js';
import { FirestoreError } from '../firestoreGateway.js';

const timeoutErr = () => new FirestoreError('Firestore timeout: getAll x');
const grpc = (code: number) => Object.assign(new Error('grpc'), { code });
const wrapped = (code: number) => new FirestoreError('Ошибка чтения', grpc(code));

describe('isTransientFirestoreError', () => {
  it('таймаут → транзиентна', () => {
    expect(isTransientFirestoreError(timeoutErr())).toBe(true);
  });
  it('ретраебельные gRPC-коды (4,8,10,13,14) → транзиентны (в т.ч. в cause)', () => {
    for (const c of [4, 8, 10, 13, 14]) {
      expect(isTransientFirestoreError(grpc(c))).toBe(true);
      expect(isTransientFirestoreError(wrapped(c))).toBe(true);
    }
  });
  it('детерминированные коды (5 NOT_FOUND, 7 PERMISSION_DENIED, 3, 6, 16) → не транзиентны', () => {
    for (const c of [3, 5, 6, 7, 16]) {
      expect(isTransientFirestoreError(grpc(c))).toBe(false);
      expect(isTransientFirestoreError(wrapped(c))).toBe(false);
    }
  });
  it('обычная ошибка / FirestoreError без cause → не транзиентна', () => {
    expect(isTransientFirestoreError(new Error('boom'))).toBe(false);
    expect(isTransientFirestoreError(new FirestoreError('нет соединения'))).toBe(false);
  });
});

describe('retryTransient', () => {
  const noSleep = vi.fn(async () => {});

  it('успех с первой попытки → 1 вызов, без сна', async () => {
    const op = vi.fn(async () => 'ok');
    const sleep = vi.fn(async () => {});
    expect(await retryTransient(op, { sleep })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('транзиентная ошибка, затем успех → повтор и возврат результата', async () => {
    let n = 0;
    const op = vi.fn(async () => {
      if (++n === 1) throw timeoutErr();
      return 'ok';
    });
    const sleep = vi.fn(async () => {});
    expect(await retryTransient(op, { sleep, baseDelayMs: 200 })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('нетранзиентная ошибка → немедленный проброс, без повторов', async () => {
    const err = wrapped(7); // PERMISSION_DENIED
    const op = vi.fn(async () => {
      throw err;
    });
    const sleep = vi.fn(async () => {});
    await expect(retryTransient(op, { sleep })).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('исчерпание попыток (всегда транзиентно) → проброс после retries+1 попыток, backoff 200/400', async () => {
    const op = vi.fn(async () => {
      throw timeoutErr();
    });
    const sleep = vi.fn(async () => {});
    await expect(retryTransient(op, { sleep, retries: 2, baseDelayMs: 200 })).rejects.toBeInstanceOf(FirestoreError);
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 200);
    expect(sleep).toHaveBeenNthCalledWith(2, 400);
  });

  it('кастомный isRetryable уважается', async () => {
    const op = vi.fn(async () => {
      throw new Error('custom-transient');
    });
    await expect(
      retryTransient(op, { sleep: noSleep, retries: 1, isRetryable: () => true }),
    ).rejects.toThrow('custom-transient');
    expect(op).toHaveBeenCalledTimes(2);
  });
});
