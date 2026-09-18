import { describe, it, expect } from 'vitest';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { InMemoryImageStore } from '../../storage/__tests__/inMemoryImageStore.js';
import { ImageStoreError, type ImageStore } from '../../storage/index.js';
import type { FirestoreGateway } from '../../db/index.js';
import { createServiceContext } from '../context.js';
import { InvoiceService, InvoiceServiceError, type Actor } from '../invoiceService.js';
import { fixedClock, countingIds } from './_helpers.js';

const actor: Actor = { id: 'u-admin', username: 'admin' };
// маленькое валидное JPEG-подобное содержимое в base64 (для теста достаточно любых байт)
const SMALL_B64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function setup(gateway?: FirestoreGateway) {
  const gw = gateway ?? new InMemoryGateway();
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { gw, ctx, svc: new InvoiceService(ctx) };
}

describe('InvoiceService.createFromUpload', () => {
  it('пишет оригинал в ImageStore и создаёт processing-накладную с imagePath=storage key (без base64 в Firestore)', async () => {
    const { ctx, svc } = setup();
    const store = new InMemoryImageStore();
    const res = await svc.createFromUpload({ name: 'н1.jpg', type: 'image/jpeg', base64: SMALL_B64 }, actor, store);

    expect(res.status).toBe('processing');
    const inv = await ctx.repositories.invoices.getById(res.invoiceId);
    expect(inv!.status).toBe('processing');
    expect(inv!.imagePath).toBe(`invoices/${res.invoiceId}/original.jpg`);
    expect(inv!.imagePath.startsWith('data:')).toBe(false); // base64 в Firestore не попал
    expect(store.size()).toBe(1);
    const stored = await store.get(inv!.imagePath);
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.data.toString()).toBe('fake-jpeg-bytes');
  });

  it('сбой ImageStore.put → ошибка пробрасывается, накладная не создаётся', async () => {
    const { gw, svc } = setup();
    const throwingStore: ImageStore = {
      put: async () => {
        throw new ImageStoreError('put failed');
      },
      get: async () => {
        throw new ImageStoreError('n/a');
      },
      delete: async () => {},
    };
    await expect(svc.createFromUpload({ type: 'image/jpeg', base64: SMALL_B64 }, actor, throwingStore)).rejects.toBeInstanceOf(ImageStoreError);
    expect(await gw.getAll('invoices')).toHaveLength(0);
  });

  it('сбой Firestore после put → compensation delete удаляет объект, исходная ошибка пробрасывается', async () => {
    const failingGateway: FirestoreGateway = {
      getAll: async () => [],
      getById: async () => null,
      set: async () => {
        throw new Error('firestore down');
      },
      delete: async () => {},
      commitBatch: async () => {},
    };
    const { svc } = setup(failingGateway);
    const store = new InMemoryImageStore();
    await expect(svc.createFromUpload({ type: 'image/jpeg', base64: SMALL_B64 }, actor, store)).rejects.toThrow('firestore down');
    expect(store.size()).toBe(0); // объект удалён компенсацией
  });

  it('слишком большое изображение → InvoiceServiceError(PAYLOAD_TOO_LARGE)', async () => {
    const { svc } = setup();
    const store = new InMemoryImageStore();
    const big = 'A'.repeat(4_500_000); // ~3.37 МБ после декодирования > лимита
    try {
      await svc.createFromUpload({ type: 'image/jpeg', base64: big }, actor, store);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvoiceServiceError);
      expect((err as InvoiceServiceError).code).toBe('PAYLOAD_TOO_LARGE');
    }
    expect(store.size()).toBe(0);
  });
});
