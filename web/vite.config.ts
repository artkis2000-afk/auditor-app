import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Отдельное Vite-приложение фронтенда. root закреплён на папке web/, чтобы скрипты
// запускались из корня репозитория. Прокси /api → backend (localhost:PORT) для dev.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_DEV_API_PROXY ?? 'http://localhost:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
