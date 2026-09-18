import { describe, it, expect } from 'vitest';
import { buildOcrDeps } from '../ocrComposition.js';
import { InMemoryImageStore } from '../storage/__tests__/inMemoryImageStore.js';

const store = new InMemoryImageStore();

describe('buildOcrDeps — политика production-fallback (KI-22)', () => {
  it('production без GEMINI_API_KEY → отказ (никакого fake OCR)', () => {
    expect(() => buildOcrDeps(store, true, {})).toThrow(/GEMINI_API_KEY/);
  });

  it('production с ключом → есть primary, fallback отсутствует', () => {
    const deps = buildOcrDeps(store, true, { GEMINI_API_KEY: 'real-key' });
    expect(deps.primary).toBeDefined();
    expect(deps.fallback).toBeUndefined();
  });

  it('non-production без ключа → демо-fallback, primary отсутствует', () => {
    const deps = buildOcrDeps(store, false, {});
    expect(deps.primary).toBeUndefined();
    expect(deps.fallback).toBeDefined();
  });

  it('non-production с ключом → primary есть, fallback не подключается', () => {
    const deps = buildOcrDeps(store, false, { GEMINI_API_KEY: 'real-key' });
    expect(deps.primary).toBeDefined();
    expect(deps.fallback).toBeUndefined();
  });
});
