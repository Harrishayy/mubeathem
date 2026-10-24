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

/**
 * Page-level horizontal overflow, and any element that pokes out past the right edge (tables scroll
 * inside their own box, so their cells are exempt). Empty when nothing overflows.
 */
async function pageOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) out.push(`page ${doc.scrollWidth} > ${doc.clientWidth}`);
    const w = doc.clientWidth;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (el.closest('.cue-table-wrap, .cue-appbar__tabs, .cue-layer, dialog:not([open])')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 8);
  });
}

const LOOKS = [
  { direction: 'honey', theme: 'light' },
  { direction: 'night', theme: 'dark' },
] as const;

/** Switches the side panel's look through synced settings, as the Settings tab does. */
async function setLook(l: { direction: string; theme: string }) {
  await sw.evaluate(async (look) => {
    const cur = (await chrome.storage.sync.get('cue.settings'))['cue.settings'] as object;
    await chrome.storage.sync.set({ 'cue.settings': { ...cur, ...look } });
  }, l);
}

/** A request to the background, sent from an extension page (the worker can't message itself). */
async function send(msg: unknown): Promise<unknown> {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/permission.html`);
  const r = await p.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await p.close();
  return r;
}

/** The call the background is following (the newest on the server). */
async function latestCallId(): Promise<string> {
  const [summary] = await (await fetch(`${serverUrl}/api/calls?limit=1`)).json();
  return summary.id as string;
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
  await expect(panel.getByRole('region', { name: 'Cue', exact: true })).toBeVisible();
  await panel.getByLabel('Type what was said').fill("Sorry, what's this regarding?");
  await panel.getByRole('button', { name: 'Add turn' }).click();

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

  // Booked from the panel's outcome bar: the call ends and the debrief opens as a dialog over it.
  await panel.getByRole('button', { name: 'Booked' }).click();
  const debrief = panel.getByRole('dialog', { name: 'How did it go?' });
  await expect(debrief).toBeVisible();
  // Escape closes it (the ended call stays); the pinned action bar opens it again.
  await panel.keyboard.press('Escape');
  await expect(debrief).toBeHidden();
  await panel.getByRole('button', { name: 'Debrief', exact: true }).click();
  await expect(debrief).toBeVisible();
  await expect(page.getByRole('button', { name: 'Debrief' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(shots, 'overlay-ended.png') });
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-debrief.png'), fullPage: true });

  // Submit the debrief: the server has the feedback and the panel moves on.
  await debrief.getByRole('button', { name: 'Save debrief' }).click();
  await expect(panel.getByRole('dialog').getByText('Booked. Nice work.')).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-after-debrief.png'), fullPage: true });
  await panel.getByRole('dialog').getByRole('button', { name: 'Next call' }).click();
  await expect(panel.getByRole('button', { name: 'Start Cue' })).toBeVisible();

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
  // The pane checks the server on open (Save and test would ask Chrome for the origin, a prompt).
  await expect(panel.getByText('Playbook lines only (no Mubit key on the server)')).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-settings.png'), fullPage: true });
  expect(await pageOverflow(panel)).toEqual([]);

  // Dispositions is its own tab: a ruled table of Trellus dispositions (the server's defaults until
  // Trellus syncs), each mapped to an outcome; an edit is saved from the pane's pinned footer.
  await panel.getByRole('link', { name: 'Dispositions' }).click();
  const table = panel.getByRole('region', { name: 'Trellus dispositions' });
  await expect(table.getByRole('columnheader', { name: 'Cue outcome' })).toBeVisible();
  await table.getByRole('combobox').first().selectOption('follow_up');
  await panel.getByRole('button', { name: 'Save 1 change' }).click();
  await expect(panel.getByText('Saved', { exact: true })).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-dispositions.png'), fullPage: true });
  expect(await pageOverflow(panel)).toEqual([]);
  const stored = await sw.evaluate(async () => JSON.stringify([await chrome.storage.sync.get(null), await chrome.storage.local.get(null)]));
  expect(stored.toLowerCase()).not.toMatch(/apikey|api_key/);
  await panel.close();
});

test('side panel renders the cue for a live call driven through the server turn API, at 320 to 520 px', async () => {
  const panel = await context.newPage();
  const errors: string[] = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  // Idle with no saved contacts yet: say so, and point at the Cue app.
  await expect(panel.getByText('No saved contacts yet')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Add contacts in Cue' })).toBeVisible();
  for (const look of LOOKS) {
    await setLook(look);
    for (const width of [360, 420]) {
      await panel.setViewportSize({ width, height: 900 });
      await settle(panel);
      expect(await pageOverflow(panel), `overflow at ${width}px ${look.direction}`).toEqual([]);
      await panel.screenshot({ path: join(shots, `sidepanel-empty-contacts-${width}-${look.direction}.png`), fullPage: true });
    }
  }
  await setLook(LOOKS[0]);
  await panel.setViewportSize({ width: 360, height: 900 });

  // Someone not saved: typed in (the start bar is pinned below), nothing overflowing.
  await panel.getByLabel('Name', { exact: true }).fill('Jordan Okafor');
  await panel.getByRole('textbox', { name: /^Company/ }).fill('Fernhill Freight');
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-start-360.png'), fullPage: true });
  expect(await pageOverflow(panel)).toEqual([]);
  await panel.getByRole('button', { name: 'Start Cue' }).click();
  await expect(panel.getByRole('link', { name: /^Call/ })).toBeVisible();
  const cuePane = panel.getByRole('region', { name: 'Cue', exact: true });
  await expect(cuePane).toBeVisible();
  await expect(panel.getByText('On a call')).toBeVisible();

  // Drive the call from outside the extension: a prospect turn posted straight to the server reaches
  // the panel over the stream the background follows.
  await expect.poll(async () => (await (await fetch(`${serverUrl}/api/calls?limit=1`)).json())[0]?.prospect?.name).toBe('Jordan Okafor');
  const callId = await latestCallId();
  const res = await fetch(`${serverUrl}/api/calls/${callId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speaker: 'prospect', text: "We already have a broker, we're fine.", via: 'typed' }),
  });
  expect(res.status).toBe(202);

  await expect(panel.locator('.cue-stage--flush .cue-line')).toBeVisible({ timeout: 20_000 });
  expect((await panel.locator('.cue-stage--flush .cue-line').innerText()).length).toBeGreaterThan(10);
  await expect(panel.locator('section.cue-pane[aria-label="Transcript"]')).toContainText('already have a broker');
  await expect(panel.getByRole('complementary', { name: 'Prospect' })).toContainText('Jordan Okafor');
  await expect(panel.getByRole('region', { name: 'Brief' })).toBeVisible();
  // Every action in reach without scrolling: the pinned bar.
  const dock = panel.getByRole('contentinfo', { name: 'Call actions' }).or(panel.locator('.sp-dock'));
  await expect(dock.getByRole('button', { name: 'End call' })).toBeInViewport();

  // Stop listening from the pinned bar; Listen asks for capture again. (Here the "call tab" is the
  // panel itself, which Chrome won't capture, so the Audio pane explains why instead.)
  await expect(panel.getByRole('region', { name: 'Audio' })).toBeVisible();
  const stop = dock.getByRole('button', { name: 'Stop listening' });
  if (await stop.isVisible()) {
    await stop.click();
    await expect(panel.getByText(/^Not listening\./)).toBeVisible();
  }
  await expect(dock.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();

  for (const width of [320, 360, 420, 520]) {
    await panel.setViewportSize({ width, height: 900 });
    await settle(panel);
    expect(await pageOverflow(panel), `overflow at ${width}px`).toEqual([]);
    if (width !== 320) await panel.screenshot({ path: join(shots, `sidepanel-live-${width}.png`), fullPage: true });
  }

  // Dark Honey and the other two directions render the same panes without overflow.
  for (const look of [{ direction: 'honey', theme: 'dark' }, { direction: 'night', theme: 'dark' }, { direction: 'signal', theme: 'light' }]) {
    await sw.evaluate(async (l) => {
      const cur = (await chrome.storage.sync.get('cue.settings'))['cue.settings'] as object;
      await chrome.storage.sync.set({ 'cue.settings': { ...cur, ...l } });
    }, look);
    await expect(panel.locator(`[data-cue][data-dir="${look.direction}"][data-theme="${look.theme}"]`).first()).toBeAttached();
    await panel.setViewportSize({ width: 360, height: 900 });
    await settle(panel);
    expect(await pageOverflow(panel), `overflow in ${look.direction}/${look.theme}`).toEqual([]);
    await panel.screenshot({ path: join(shots, `sidepanel-live-${look.direction}-${look.theme}.png`), fullPage: true });
  }
  await sw.evaluate(async () => {
    const cur = (await chrome.storage.sync.get('cue.settings'))['cue.settings'] as object;
    await chrome.storage.sync.set({ 'cue.settings': { ...cur, direction: 'honey', theme: 'light' } });
  });

  // End without an outcome from the pinned bar: the debrief dialog asks for one.
  await dock.getByRole('button', { name: 'End call' }).click();
  const debrief = panel.getByRole('dialog', { name: 'How did it go?' });
  await expect(debrief).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-debrief-360.png') });
  expect(await pageOverflow(panel)).toEqual([]);
  await debrief.getByRole('button', { name: 'Skip' }).click();
  await expect(debrief).toBeHidden();
  await panel.getByRole('button', { name: 'Next call' }).click();
  await expect(panel.getByRole('button', { name: 'Start Cue' })).toBeVisible();
  expect(errors, 'panel errors').toEqual([]);
  await panel.close();
});

test('overlay: collapsed by default in a shadow root, never blocks the page, drags, expands with a bounded panel, Esc collapses', async () => {
  // Drive a call so the expanded panel has a card in it.
  const page = await openContact();
  await page.setViewportSize({ width: 1280, height: 600 });
  const host = page.locator('cue-overlay');
  expect(await host.evaluate((el) => !!el.shadowRoot && el.shadowRoot.mode)).toBe('open');
  await expect(page.locator('.cue-overbar')).toHaveAttribute('data-mode', 'collapsed');

  // The page under and beside the bar still takes clicks.
  const passThrough = await page.evaluate(() => {
    const hit = document.elementFromPoint(40, 300);
    const corner = document.elementFromPoint(1270, 590);
    const host = document.querySelector('cue-overlay');
    return { left: hit !== host, corner: corner !== host };
  });
  expect(passThrough).toEqual({ left: true, corner: true });

  await page.getByRole('button', { name: 'Start Cue' }).click();
  await expect(page.locator('.cue-bar__live-text')).toHaveText('Live');
  await fetch(`${serverUrl}/api/calls/${await latestCallId()}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speaker: 'prospect', text: 'Just send me an email.', via: 'typed' }),
  });
  await expect(page.locator('.cue-bar__moment').first()).toBeVisible({ timeout: 20_000 });

  // Drag sideways by Sprout.
  const before = (await page.locator('.cue-bar').first().boundingBox())!;
  const handle = (await page.locator('.cue-bar__mascot').first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 120, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.move(handle.x - 200, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = (await page.locator('.cue-bar').first().boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 100);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);

  // Expand: the panel is bounded by the viewport and scrolls inside itself.
  await page.getByRole('button', { name: 'Expand' }).first().click();
  const panel = page.locator('.cue-overbar__panel');
  await expect(panel).toBeVisible();
  await settle(page);
  const box = (await panel.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  const scrolls = await panel.evaluate((el) => ({ overflowY: getComputedStyle(el).overflowY, fits: el.scrollHeight <= el.clientHeight + 1 }));
  expect(['auto', 'scroll']).toContain(scrolls.overflowY);
  await page.screenshot({ path: join(shots, 'overlay-expanded-olive.png') });

  // Escape (focus inside Cue) collapses it, and keys never reach the page's own shortcuts.
  await page.evaluate(() => {
    (window as unknown as { pageKeys: string[] }).pageKeys = [];
    window.addEventListener('keydown', (e) => (window as unknown as { pageKeys: string[] }).pageKeys.push(e.key));
  });
  await page.getByRole('button', { name: 'Collapse' }).first().focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('.cue-overbar')).toHaveAttribute('data-mode', 'collapsed');
  expect(await page.evaluate(() => (window as unknown as { pageKeys: string[] }).pageKeys)).toEqual([]);
  await settle(page);
  await page.screenshot({ path: join(shots, 'overlay-collapsed-olive.png') });

  // Leave things clean for the next test.
  await page.evaluate(() => localStorage.removeItem('cue.overbar.x'));
  await send({ type: 'session.end' });
  await send({ type: 'session.reset' });
  await page.close();
});

test('a saved contact: search, pick by keyboard, research warms, the call carries the contact, and last time shows next time', async () => {
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${serverUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(r.ok, `${path} ${r.status}`).toBe(true);
    return r.json();
  };
  const contact = await post('/api/contacts', { name: 'Priya Natarajan', title: 'VP Operations', company: 'Harbourline Logistics', phone: '+14155550199', email: 'priya@harbourline.example', facts: { fleet: '140 trucks' }, notes: 'Asked to be called after their Q3 board meeting.' });
  await post('/api/contacts', { name: 'Tomás Herrera', title: 'Founder', company: 'Brightwell Analytics', phone: '+14155550111', facts: {} });

  // A previous call with Priya, reviewed by the rep, so "Last time" has something to say.
  const prev = await post('/api/calls', { source: 'cue', contactId: contact.id, prospect: {}, rep: { id: 'rep_e2e', name: 'Alex Rivera' } });
  await post(`/api/calls/${prev.id}/turns`, { speaker: 'prospect', text: 'We already have a broker for most lanes.', via: 'typed' });
  await post(`/api/calls/${prev.id}/end`, { outcome: 'callback_requested' });
  await post(`/api/calls/${prev.id}/feedback`, { outcome: 'callback_requested', rating: 4, whatWorked: 'She opened up about lane costs.', whatDidnt: 'I pitched before asking about the broker.' });

  const panel = await context.newPage();
  const errors: string[] = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  const search = panel.getByRole('combobox', { name: 'Search contacts' });
  await expect(search).toBeVisible();
  const list = panel.getByRole('listbox', { name: 'Saved contacts' });
  await expect(list.getByRole('option')).toHaveCount(2);
  for (const look of LOOKS) {
    await setLook(look);
    for (const width of [360, 420]) {
      await panel.setViewportSize({ width, height: 900 });
      await settle(panel);
      expect(await pageOverflow(panel), `overflow at ${width}px ${look.direction}`).toEqual([]);
      await panel.screenshot({ path: join(shots, `sidepanel-start-contacts-${width}-${look.direction}.png`), fullPage: true });
    }
  }
  await setLook(LOOKS[0]);
  await panel.setViewportSize({ width: 360, height: 900 });

  // Search as you type, then pick with the keyboard.
  await search.fill('harbour');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option').first()).toContainText('Priya Natarajan');
  await expect(list.getByRole('option').first()).toContainText('VP Operations · Harbourline Logistics');
  await search.press('ArrowDown');
  await search.press('Enter');

  const calling = panel.getByRole('complementary', { name: 'Calling' });
  await expect(calling).toContainText('Priya Natarajan');
  await expect(calling).toContainText('Callback requested');
  await expect(calling.getByRole('status').first()).toBeVisible(); // research is warming
  await expect(panel.getByText('Calling Priya Natarajan')).toBeVisible();

  await panel.getByRole('button', { name: 'Start Cue' }).click();
  await expect(panel.getByText('On a call')).toBeVisible();
  await expect.poll(async () => (await (await fetch(`${serverUrl}/api/calls?limit=1`)).json())[0]?.contactId).toBe(contact.id);
  const callId = await latestCallId();
  expect(callId).not.toBe(prev.id);
  // The server filled the prospect from the saved contact.
  await expect(panel.getByRole('complementary', { name: 'Prospect' })).toContainText('Harbourline Logistics');
  const lastTime = panel.getByRole('region', { name: 'Last time' });
  await expect(lastTime).toContainText('Callback requested');
  await expect(panel.getByRole('region', { name: 'Brief' }).locator('.cue-brief__summary')).toBeVisible({ timeout: 20_000 });
  await post(`/api/calls/${callId}/turns`, { speaker: 'prospect', text: "Who is this? I've only got a minute.", via: 'typed' });
  await expect(panel.locator('.cue-stage--flush .cue-line')).toBeVisible({ timeout: 20_000 });

  for (const look of LOOKS) {
    await setLook(look);
    for (const width of [360, 420]) {
      await panel.setViewportSize({ width, height: 900 });
      await settle(panel);
      expect(await pageOverflow(panel), `overflow at ${width}px ${look.direction}`).toEqual([]);
      await panel.screenshot({ path: join(shots, `sidepanel-live-contact-${width}-${look.direction}.png`), fullPage: true });
    }
  }
  await setLook(LOOKS[0]);

  await send({ type: 'session.end' });
  await send({ type: 'session.reset' });
  await expect(panel.getByRole('button', { name: 'Start Cue' })).toBeVisible();
  expect(errors, 'panel errors').toEqual([]);
  await panel.close();
});

test('a person read from the page can be saved to contacts and called as one', async () => {
  const page = await openContact();
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const fromPage = panel.getByRole('region', { name: 'From this page' });
  await expect(fromPage).toBeVisible();
  await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Maya Chen');
  await fromPage.getByRole('button', { name: 'Save to contacts' }).click();
  await expect(panel.getByRole('complementary', { name: 'Calling' })).toContainText('Maya Chen');
  const saved = await (await fetch(`${serverUrl}/api/contacts?q=Maya`)).json();
  expect(saved.items.map((c: { name: string }) => c.name)).toContain('Maya Chen');
  await settle(panel);
  expect(await pageOverflow(panel)).toEqual([]);
  await panel.close();
  await page.close();
});
