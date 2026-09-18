import { describe, it, expect } from 'vitest';
import { InMemoryImageStore } from './inMemoryImageStore.js';
import { ImageStoreError } from '../imageStore.js';
import { buildInvoiceImageKey, extensionForMime } from '../imageKeys.js';

describe('InMemoryImageStore', () => {
  it('put → get возвращает те же данные и contentType', async () => {
    const store = new InMemoryImageStore();
    const data = Buffer.from('hello');
    await store.put('invoices/inv-1/original.jpg', data, 'image/jpeg');
    const got = await store.get('invoices/inv-1/original.jpg');
    expect(got.data.toString()).toBe('hello');
    expect(got.contentType).toBe('image/jpeg');
  });

  it('get отсутствующего объекта → ImageStoreError', async () => {
    const store = new InMemoryImageStore();
    await expect(store.get('nope')).rejects.toBeInstanceOf(ImageStoreError);
  });
});

describe('imageKeys', () => {
  it('строит детерминированный ключ invoices/{id}/original.<ext>', () => {
    expect(buildInvoiceImageKey('inv-123', 'image/jpeg')).toBe('invoices/inv-123/original.jpg');
    expect(buildInvoiceImageKey('inv-123', 'image/png')).toBe('invoices/inv-123/original.png');
  });

  it('расширение по MIME; неизвестный тип → bin', () => {
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/jpeg; charset=binary')).toBe('jpg');
    expect(extensionForMime('application/octet-stream')).toBe('bin');
  });

  it('санитизирует invoiceId — нет path traversal', () => {
    expect(buildInvoiceImageKey('../../etc/passwd', 'image/png')).toBe('invoices/etcpasswd/original.png');
    expect(() => buildInvoiceImageKey('///', 'image/png')).toThrow(ImageStoreError);
    expect(() => buildInvoiceImageKey('..', 'image/png')).toThrow(ImageStoreError);
  });
});
