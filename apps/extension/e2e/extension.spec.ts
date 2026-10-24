import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';

/**
 * The built extension in Chromium against a fixture HubSpot contact page with a Trellus dialer and
 * hostile CSS (`* { all: unset }`, a transformed body, a 10 px root font, a max-z-index launcher),
 * talking to a real @cue/server on the rules engine (no Mubit key, no network models).
 */

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..', '.output', 'chrome-mv3');
const serverDir = join(here, '..', '..', 'server');
const shots = join(here, '..', '..', '..', 'test-results', 'extension');
const fixture = readFileSync(join(here, '..', 'test', 'fixtures', 'hubspot-contact.html'), 'utf8');
const HS_URL = 'https://app.hubspot.com/contacts/2114/record/0-1/90121';

let context: BrowserContext;
let sw: Worker;
let extId: string;
let server: ChildProcess;
let serverUrl: string;
let tmp: string;

/**
 * Extensions need full Chromium (not the headless shell). Use Playwright's own build when it is
 * installed; otherwise the newest Chromium already in the Playwright cache, so the test runs
 * without a download. CUE_E2E_CHROMIUM overrides both.
 */
function chromiumPath(): string | undefined {
  if (process.env.CUE_E2E_CHROMIUM) return process.env.CUE_E2E_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const linuxCache = join(homedir(), '.cache', 'ms-playwright');
  for (const dir of [cache, linuxCache]) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      for (const rel of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = join(dir, b, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

async function waitForHealth(url: string, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Cue server did not start');
}

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  tmp = mkdtempSync(join(tmpdir(), 'cue-ext-e2e-'));
  const port = await freePort();
  serverUrl = `http://localhost:${port}`;
  server = spawn(join(serverDir, 'node_modules', '.bin', 'tsx'), ['src/main.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      // Rules engine only: never spend model credit in this test.
      MUBIT_API_KEY: '',
      TRELLUS_API_KEY: '',
      EXA_API_KEY: '',
      SAPLING_URL: '',
      CUE_API_TOKEN: '',
      TRELLUS_POLL_SECONDS: '0',
      CUE_PORT: String(port),
      CUE_DB_PATH: join(tmp, 'cue.db'),
      CUE_ALLOWED_ORIGINS: 'chrome-extension://*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(serverUrl);

  context = await chromium.launchPersistentContext(join(tmp, 'profile'), {
    channel: 'chromium',
    executablePath: chromiumPath(),
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
  await sw.evaluate(async (url) => {
    await chrome.storage.sync.set({ 'cue.settings': { serverUrl: url, rep: { id: 'rep_e2e', name: 'Alex Rivera' } } });
  }, serverUrl);
  await context.route('https://app.hubspot.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
});

test.afterAll(async () => {
  await context?.close();
  server?.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
});

/** Lets cross-fades and staggered entrances finish, and scrolls to the top, before a screenshot. */
async function settle(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

async function openContact(): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(HS_URL);
  await expect(page.locator('cue-overlay')).toBeAttached();
  expect(errors, 'page errors').toEqual([]);
  return page;
}

test('loads with no manifest errors and a running service worker', async () => {
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe('Cue');
  const errors = await sw.evaluate(() => (chrome.runtime.lastError ? chrome.runtime.lastError.message : null));
  expect(errors).toBeNull();
});

test('overlay mounts in a shadow root, reads the contact, and survives hostile page CSS', async () => {
  const page = await openContact();

  const inShadow = await page.evaluate(() => {
    const host = document.querySelector('cue-overlay');
    return { shadow: !!host?.shadowRoot?.querySelector('.cue-bar'), leaked: !!document.querySelector('.cue-bar'), parent: host?.parentElement?.tagName };
  });
  expect(inShadow).toEqual({ shadow: true, leaked: false, parent: 'HTML' });

  const bar = page.locator('.cue-bar').first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(56);
  expect(box.height).toBeGreaterThan(30);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeLessThanOrEqual(24);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(4); // centred

  const style = await bar.evaluate((el) => {
    const cs = getComputedStyle(el);
    const text = el.querySelector('.cue-bar__text');
    return { bg: cs.backgroundColor, font: text ? getComputedStyle(text).fontFamily : '', display: cs.display, size: text ? getComputedStyle(text).fontSize : '' };
  });
  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.font).not.toMatch(/Comic Sans/);
  expect(style.display).not.toBe('inline');
  expect(parseFloat(style.size)).toBeGreaterThanOrEqual(12); // px tokens: the page's 10 px root doesn't shrink Cue

  // The overlay sits above the page's max-z-index launcher.
  const onTop = await page.evaluate(() => {
    const host = document.querySelector('cue-overlay')!;
    const bar = host.shadowRoot!.querySelector('.cue-bar')!.getBoundingClientRect();
    const hit = document.elementFromPoint(bar.x + bar.width / 2, bar.y + bar.height / 2);
    return hit === host;
  });
  expect(onTop).toBe(true);

  // The prompt card lives in the Overbar's accessory slot, so it moves with the bar.
  expect(await page.locator('.cxo-card').evaluate((el) => !!el.closest('.cue-overbar__accessory'))).toBe(true);
  await expect(page.locator('.cxo-name')).toHaveText('Maya Chen');
  await expect(page.locator('.cxo-meta')).toHaveText('CEO · Lumen Labs');
  await expect(page.locator('.cxo-kicker')).toHaveText('Ready to call');
  await page.screenshot({ path: join(shots, 'overlay-idle.png') });

  // Trellus connects: the overlay offers Start.
  await page.evaluate(() => (window as unknown as { setDialer(s: string): void }).setDialer('connected'));
  await expect(page.locator('.cxo-kicker')).toHaveText('Trellus connected');
  await page.screenshot({ path: join(shots, 'overlay-trellus-connected.png') });

  // Narrow window (a laptop split with the dialer): the bar and the card stay inside the viewport.
  await page.setViewportSize({ width: 380, height: 760 });
  await settle(page);
  for (const sel of ['.cue-bar', '.cxo-card']) {
    const b = (await page.locator(sel).first().boundingBox())!;
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(380);
  }
  await page.screenshot({ path: join(shots, 'overlay-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Edit the contact manually.
  await page.getByRole('button', { name: 'Edit contact' }).click();
  await page.locator('.cxo-form').getByLabel('Title').fill('Founder & CEO');
  await page.getByRole('button', { name: 'Use these details' }).click();
  await expect(page.locator('.cxo-meta')).toHaveText('Founder & CEO · Lumen Labs');

  // If the page throws our host away, it comes back.
  await page.evaluate(() => document.querySelector('cue-overlay')!.remove());
  await expect(page.locator('cue-overlay')).toBeAttached();
  await expect(page.locator('.cue-bar').first()).toBeVisible();
  await page.close();
});

test('a call end to end: start from the page, a prospect turn, a card, end, debrief', async () => {
  const page = await openContact();
  await page.evaluate(() => (window as unknown as { setDialer(s: string): void }).setDialer('connected'));
  await page.getByRole('button', { name: 'Start Cue' }).click();
  await expect(page.locator('.cue-bar__live-text')).toHaveText('Live');

  // Tab capture needs the rep to have invoked Cue on the tab; the overlay says so with a retry.
  await expect(page.locator('.cxo-row--note .cxo-note')).toContainText(/Cue icon|Alt\+Shift\+C|hear/);
  await page.screenshot({ path: join(shots, 'overlay-live-capture-note.png') });

  // The side panel (opened as a page here) adds a typed prospect turn.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await expect(panel.locator('.cue-overbar--inline')).toBeVisible();
  await panel.getByLabel('Type what was said').fill("Sorry, what's this regarding?");
  await panel.getByRole('button', { name: 'Add', exact: true }).click();

  // The card arrives on the page's overbar (rules engine) and in the panel.
  await expect(page.locator('.cue-bar__moment').first()).toBeVisible({ timeout: 20_000 });
  const line = await page.locator('.cue-bar__text').first().innerText();
  expect(line.length).toBeGreaterThan(10);
  await settle(page);
  await page.screenshot({ path: join(shots, 'overlay-live-card.png') });

  await page.getByRole('button', { name: 'Expand' }).first().click();
  await expect(page.locator('.cue-overbar__panel')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(shots, 'overlay-expanded.png') });
  await page.getByRole('button', { name: 'Collapse' }).first().click();

  await expect(panel.locator('.cue-stage')).toBeVisible();
  // Keyboard: U marks the card used (focus outside any field).
  await panel.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await panel.keyboard.press('u');
  await expect
    .poll(async () => {
      const [summary] = await (await fetch(`${serverUrl}/api/calls?limit=1`)).json();
      const v = await (await fetch(`${serverUrl}/api/calls/${summary.id}`)).json();
      return v.history.at(-1)?.action ?? null;
    })
    .toBe('used');
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-live.png'), fullPage: true });

  // Booked from the panel's outcome bar: the call ends and the debrief shows.
  await panel.getByRole('button', { name: 'Booked' }).click();
  await expect(panel.getByRole('group', { name: 'Call outcome' }).or(panel.locator('.cue-debrief, form')).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Debrief' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(shots, 'overlay-ended.png') });
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-debrief.png'), fullPage: true });

  // Submit the debrief: the server has the feedback and the panel moves on.
  await panel.getByRole('button', { name: 'Save debrief' }).click();
  await expect(panel.getByText('Booked. Nice work.')).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-after-debrief.png'), fullPage: true });

  const call = await (await fetch(`${serverUrl}/api/calls?limit=1`)).json();
  expect(['ended', 'reviewing', 'reviewed']).toContain(call[0].status);
  expect(call[0]).toMatchObject({ outcome: 'meeting_booked', prospect: { name: 'Maya Chen' } });
  await panel.close();
  await page.close();
});

test('side panel settings render, and the Trellus key field never persists', async () => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 1100 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html#settings`);
  await expect(panel.getByLabel('Server URL')).toHaveValue(serverUrl);
  await expect(panel.getByText('Trellus not connected')).toBeVisible();
  await expect(panel.getByText('Dispositions to outcomes')).toBeVisible();
  await panel.screenshot({ path: join(shots, 'sidepanel-settings.png'), fullPage: true });
  const overflow = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const stored = await sw.evaluate(async () => JSON.stringify([await chrome.storage.sync.get(null), await chrome.storage.local.get(null)]));
  expect(stored.toLowerCase()).not.toMatch(/apikey|api_key/);
  await panel.close();
});
