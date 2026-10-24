import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) } },
  build: { outDir: '../dist/public', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: {
    root: '.',
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts'],
    environment: 'node',
  },
});
