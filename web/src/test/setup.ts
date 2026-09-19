import { afterEach, vi } from 'vitest';

// setupFiles глобальны для всех проектов vitest, но RTL/jest-dom нужны только в jsdom (web).
// В node-окружении (backend-тесты) document отсутствует — там ничего не подключаем.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  // jsdom не реализует object URL — заглушки для ImagePreview.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:mock';
    URL.revokeObjectURL = () => undefined;
  }
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
}
