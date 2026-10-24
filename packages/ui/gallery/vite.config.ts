import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  server: { port: 5180, strictPort: false },
  preview: { port: 5180 },
  build: { chunkSizeWarningLimit: 800, outDir: fileURLToPath(new URL('../dist/gallery', import.meta.url)), emptyOutDir: true },
});
