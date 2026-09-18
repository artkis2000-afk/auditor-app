import { describe, it, expect } from 'vitest';
import {
  FirebaseStorageGateway,
  createFirebaseStorageGateway,
  type BucketLike,
} from '../firebaseStorageGateway.js';
import { ImageStoreError } from '../imageStore.js';
import type { FirebaseEnv } from '../../db/env.js';

interface FakeFile {
  data?: Buffer;
  contentType?: string;
  exists: boolean;
}

function fakeBucket(initial: Record<string, FakeFile> = {}): {
  bucket: BucketLike;
  files: Record<string, FakeFile>;
} {
  const files = initial;
  const bucket: BucketLike = {
    file(key: string) {
      return {
        async save(data: Buffer, options: { contentType: string }) {
          files[key] = { data, contentType: options.contentType, exists: true };
          return undefined;
        },
        async exists(): Promise<[boolean]> {
          return [Boolean(files[key]?.exists)];
        },
        async download(): Promise<[Buffer]> {
          return [files[key]!.data!];
        },
        async getMetadata(): Promise<[{ contentType?: string }]> {
          return [{ contentType: files[key]?.contentType }];
        },
      };
    },
  };
  return { bucket, files };
}

describe('FirebaseStorageGateway (fake bucket)', () => {
  it('put сохраняет данные и contentType в бакет', async () => {
    const { bucket, files } = fakeBucket();
    const gw = new FirebaseStorageGateway(bucket);
    await gw.put('invoices/inv-1/original.jpg', Buffer.from('img'), 'image/jpeg');
    expect(files['invoices/inv-1/original.jpg']!.contentType).toBe('image/jpeg');
    expect(files['invoices/inv-1/original.jpg']!.data!.toString()).toBe('img');
  });

  it('get существующего объекта → данные + contentType', async () => {
    const { bucket } = fakeBucket({
      'k1': { data: Buffer.from('bytes'), contentType: 'image/png', exists: true },
    });
    const gw = new FirebaseStorageGateway(bucket);
    const got = await gw.get('k1');
    expect(got.data.toString()).toBe('bytes');
    expect(got.contentType).toBe('image/png');
  });

  it('get отсутствующего объекта → ImageStoreError', async () => {
    const { bucket } = fakeBucket();
    const gw = new FirebaseStorageGateway(bucket);
    await expect(gw.get('missing')).rejects.toBeInstanceOf(ImageStoreError);
  });

  it('get без contentType в метаданных → application/octet-stream', async () => {
    const { bucket } = fakeBucket({ k2: { data: Buffer.from('x'), exists: true } });
    const gw = new FirebaseStorageGateway(bucket);
    const got = await gw.get('k2');
    expect(got.contentType).toBe('application/octet-stream');
  });

  it('put+get через один gateway (round-trip)', async () => {
    const { bucket } = fakeBucket();
    const gw = new FirebaseStorageGateway(bucket);
    await gw.put('k3', Buffer.from('roundtrip'), 'image/webp');
    const got = await gw.get('k3');
    expect(got.data.toString()).toBe('roundtrip');
    expect(got.contentType).toBe('image/webp');
  });
});

describe('createFirebaseStorageGateway (config)', () => {
  it('без имени бакета → ImageStoreError (до обращения к Firebase)', () => {
    const env: FirebaseEnv = { projectId: 'p', databaseId: '(default)' };
    expect(() => createFirebaseStorageGateway(env)).toThrow(ImageStoreError);
  });
});
