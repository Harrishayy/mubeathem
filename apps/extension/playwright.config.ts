import { defineConfig } from '@playwright/test';

/**
 * Loads the built extension (.output/chrome-mv3) into Chromium and drives it on a local fixture
 * served at a real HubSpot URL (requests are fulfilled by Playwright, so the real manifest's
 * content-script matches apply). Run `pnpm --filter @cue/extension e2e` (builds first).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/extension/artifacts',
});
