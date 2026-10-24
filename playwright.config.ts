import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';

/**
 * Playwright across viewports and themes. The `ui-*` projects run tests/e2e/ui*.spec.ts against the
 * @cue/ui gallery; other workstreams add their own projects (e.g. `web-*`) next to these.
 */
const UI_PORT = 5180;
const viewports = [
  { name: '320', width: 320, height: 640 },
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1920', width: 1920, height: 1080 },
];

/* ── ws06: apps/web against a real @cue/server on the rules engine (MUBIT_API_KEY empty, throwaway db) ── */
const WEB_PORT = 5183;
const WEB_API_PORT = 8863;
const webProjects = viewports.flatMap((v) =>
  (['light', 'dark'] as const).map((scheme) => ({
    name: `web-${v.name}-${scheme}`,
    testMatch: /web.*\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.width <= 768 ? 2 : 1,
      hasTouch: v.width <= 768,
      colorScheme: scheme,
      baseURL: `http://localhost:${WEB_PORT}`,
    },
  })),
);
const webServers = [
  {
    command: `pnpm --filter @cue/server dev`,
    url: `http://localhost:${WEB_API_PORT}/health`,
    env: { MUBIT_API_KEY: '', EXA_API_KEY: '', TRELLUS_API_KEY: '', TRELLUS_POLL_SECONDS: '0', CUE_PORT: String(WEB_API_PORT), CUE_DB_PATH: `${tmpdir()}/cue-e2e-web-${Date.now()}.db` },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  {
    command: `pnpm --filter @cue/web dev --port ${WEB_PORT} --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    env: { CUE_PORT: String(WEB_API_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [...viewports.map((v) => ({
    name: `ui-${v.name}`,
    testMatch: /ui.*\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.width <= 768 ? 2 : 1,
      hasTouch: v.width <= 768,
      baseURL: `http://localhost:${UI_PORT}`,
    },
  })),
  ...webProjects],
  webServer: [{
    command: `pnpm --filter @cue/ui dev --port ${UI_PORT} --strictPort`,
    url: `http://localhost:${UI_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  }, ...webServers],
});
