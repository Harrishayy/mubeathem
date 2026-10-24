import { defineConfig } from 'wxt';
import { buildManifest, serverOrigin } from './src/manifest';

/**
 * Cue for Chrome (MV3). The manifest itself is built by `src/manifest.ts` so a unit test can assert
 * it without running WXT. Set CUE_SERVER_ORIGIN at build time to bake in another default server;
 * any other server can still be chosen in Settings (granted at runtime via optional host permissions).
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  publicDir: 'public',
  imports: false,
  manifest: buildManifest(serverOrigin(process.env.CUE_SERVER_ORIGIN)),
  vite: () => ({
    define: { __CUE_DEFAULT_SERVER__: JSON.stringify(serverOrigin(process.env.CUE_SERVER_ORIGIN)) },
    build: { chunkSizeWarningLimit: 1200 },
  }),
});
