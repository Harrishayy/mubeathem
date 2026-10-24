import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API server the dev/preview servers proxy /api and /health to (same origin = no CORS setup).
const target = process.env.CUE_SERVER_URL ?? `http://localhost:${process.env.CUE_PORT ?? 8787}`;
const proxy = {
  '/api': { target, changeOrigin: true },
  '/health': { target, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: false, proxy },
  preview: { port: Number(process.env.WEB_PORT ?? 5173), proxy },
  // One ~600 kB (186 kB gzip) bundle: zod contracts + motion + React. Cached by the service worker.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
