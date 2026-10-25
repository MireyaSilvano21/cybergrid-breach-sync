import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) } },
  build: {
    outDir: '../dist/public', emptyOutDir: true,
    // Segunda página: visor del esqueleto de personajes (/rig.html).
    rollupOptions: { input: { main: fileURLToPath(new URL('./client/index.html', import.meta.url)), rig: fileURLToPath(new URL('./client/rig.html', import.meta.url)) } },
  },
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
