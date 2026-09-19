import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: [
      'shared/**/*.test.ts',
      'domain/**/*.test.ts',
      'server/**/*.test.ts',
      'web/**/*.test.{ts,tsx}',
    ],
    // Backend/domain/shared — node; фронтенд (web/) — jsdom.
    environment: 'node',
    environmentMatchGlobs: [['web/**', 'jsdom']],
    setupFiles: ['web/src/test/setup.ts'],
  },
});
