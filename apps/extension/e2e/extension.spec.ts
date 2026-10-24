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
    // Auto-start off by default here so each test drives the call itself; the companion test turns it on.
    await chrome.storage.sync.set({ 'cue.settings': { serverUrl: url, autoStart: false, rep: { id: 'rep_e2e', name: 'Alex Rivera' } } });
  }, serverUrl);
  await context.route('https://app.hubspot.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  // A source the brief could cite, and the Cue web app (the settings bridge runs there).
  await context.route('https://news.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Lumen Labs raises $12M</title><h1>Lumen Labs raises $12M</h1>' }));
  await context.route('http://localhost:5173/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cue</title><p>Cue web app</p>' }));
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

  // Nothing to fill in on the page: details come from HubSpot and are fixed there or in the Cue app.
  await expect(page.getByRole('button', { name: 'Edit contact' })).toHaveCount(0);
  await expect(page.locator('cue-overlay').locator('input, textarea')).toHaveCount(0);

  // If the page throws our host away, it comes back.
  await page.evaluate(() => document.querySelector('cue-overlay')!.remove());
  await expect(page.locator('cue-overlay')).toBeAttached();
  await expect(page.locator('.cue-bar').first()).toBeVisible();
  await page.close();
});

/** Sets fields of the synced settings, as the Cue web app's bridge does. */
async function setSettings(patch: Record<string, unknown>) {
  await sw.evaluate(async (p) => {
    const cur = (await chrome.storage.sync.get('cue.settings'))['cue.settings'] as object;
    await chrome.storage.sync.set({ 'cue.settings': { ...cur, ...p } });
  }, patch);
}

const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
const dial = (page: Page, state: 'idle' | 'dialing' | 'connected' | 'ended') => page.evaluate((s) => (window as unknown as { setDialer(s: string): void }).setDialer(s), state);
const postTurn = (callId: string, speaker: 'prospect' | 'rep', text: string) =>
  fetch(`${serverUrl}/api/calls/${callId}/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speaker, text, via: 'typed' }) });

test('the companion follows Trellus by itself: the brief while it dials, the line and transcript on the call, the wrap-up after', async () => {
  await setSettings({ autoStart: true });
  const page = await openContact();
  const panel = await context.newPage();
  const errors: string[] = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  // Before the call: the brief for the person on the page, and nothing to fill in.
  await expect(panel.locator('.sp-who__name')).toHaveText('Maya Chen');
  await expect(panel.locator('.sp-who__role')).toHaveText('CEO · Lumen Labs');
  await expect(panel.locator('#say .sp-opener')).toContainText('Maya');
  await expect(panel.locator('#why .sp-hook').first()).toBeVisible();
  await expect(panel.locator('#company .sp-fact').first()).toBeVisible();
  await expect(panel.locator('#history')).toContainText(/Nobody on the team|past call/);
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: /Settings in Cue/ })).toHaveAttribute('href', /#\/settings$/);
  // The toolbar badge counts the reasons to call now.
  await expect.poll(badge).toMatch(/^[1-5]$/);
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-ready.png') });
  for (const width of [320, 360, 520]) {
    await panel.setViewportSize({ width, height: 900 });
    await settle(panel);
    expect(await pageOverflow(panel), `ready overflow at ${width}px`).toEqual([]);
  }
  await panel.setViewportSize({ width: 400, height: 900 });

  // Trellus dials, then connects: Cue starts on its own.
  await dial(page, 'dialing');
  await expect(panel.locator('.sp-head__status')).toHaveText('Ringing');
  await expect(panel.locator('.sp-who__kicker')).toHaveText('Trellus is dialling');
  await dial(page, 'connected');
  await expect(panel.locator('.sp-head__status')).toContainText('Live');
  await expect(page.locator('.cue-bar__live-text')).toHaveText('Live');
  await expect.poll(async () => (await (await fetch(`${serverUrl}/api/calls?limit=1`)).json())[0]?.source).toBe('trellus');
  const callId = await latestCallId();

  // The prospect speaks: the moment, the line to say, and the transcript, live.
  expect((await postTurn(callId, 'prospect', "Sorry, what's this regarding?")).status).toBe(202);
  await expect(panel.locator('.sp-linecard .cue-line')).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.sp-transcript')).toContainText("what's this regarding");
  await expect(panel.locator('.sp-transcript .sp-moment').first()).toBeVisible();
  await expect(panel.locator('.sp-turn.is-latest')).toContainText("what's this regarding");
  await expect.poll(badge).toMatch(/^(\d+:\d\d|!)$/);

  // U marks the line used; the rep's next turn gets the tick.
  await panel.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await panel.keyboard.press('u');
  await expect.poll(async () => (await (await fetch(`${serverUrl}/api/calls/${callId}`)).json()).history.at(-1)?.action ?? null).toBe('used');
  await postTurn(callId, 'rep', 'Honestly? Insurance. Thirty seconds and I will let you go.');
  await expect(panel.locator('.sp-used')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'End call' })).toBeInViewport();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-live.png') });
  for (const width of [320, 360, 420, 520]) {
    await panel.setViewportSize({ width, height: 900 });
    await settle(panel);
    expect(await pageOverflow(panel), `live overflow at ${width}px`).toEqual([]);
  }
  for (const look of [{ direction: 'honey', theme: 'dark' }, { direction: 'night', theme: 'dark' }, { direction: 'signal', theme: 'light' }]) {
    await setLook(look);
    await expect(panel.locator(`[data-cue][data-dir="${look.direction}"][data-theme="${look.theme}"]`).first()).toBeAttached();
    await panel.setViewportSize({ width: 360, height: 900 });
    await settle(panel);
    expect(await pageOverflow(panel), `overflow in ${look.direction}/${look.theme}`).toEqual([]);
    await panel.screenshot({ path: join(shots, `sidepanel-live-${look.direction}-${look.theme}.png`) });
  }
  await setLook({ direction: 'honey', theme: 'light' });
  await panel.setViewportSize({ width: 400, height: 900 });

  // Trellus hangs up: Cue ends the call and shows the wrap-up. No outcome from Trellus here, so one tap.
  await dial(page, 'ended');
  await expect(panel.locator('.sp-head__status')).toHaveText('Ended');
  const outcome = panel.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toContainText('Waiting for Trellus');
  await expect(page.getByRole('button', { name: 'See the wrap-up' })).toBeVisible();
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-wrap-waiting.png') });
  await outcome.getByRole('button', { name: 'Booked' }).click();
  await expect(outcome).toContainText('Outcome · confirmed');
  await expect(outcome).toContainText('Meeting booked');
  await expect(panel.locator('.sp-landed')).toContainText('Insurance');
  await expect(panel.getByRole('link', { name: /Full debrief/ })).toHaveAttribute('href', new RegExp(`#/debrief/${callId}$`));
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-wrap.png') });
  expect(await pageOverflow(panel)).toEqual([]);
  await expect.poll(async () => (await (await fetch(`${serverUrl}/api/calls?limit=1`)).json())[0]?.outcome).toBe('meeting_booked');

  await panel.getByRole('button', { name: 'Next call' }).click();
  await expect(panel.locator('#say')).toBeVisible();
  await expect(panel.locator('#history')).toContainText('Meeting booked');
  expect(errors, 'panel errors').toEqual([]);
  await setSettings({ autoStart: false });
  await dial(page, 'idle');
  await panel.close();
  await page.close();
});

test('a source opens beside the call tab, reuses its tab for the next one, and closes', async () => {
  const page = await openContact();
  await page.getByRole('button', { name: 'Start Cue' }).click();
  await expect(page.locator('.cue-bar__live-text')).toHaveText('Live');

  const res = (await send({ type: 'beside.open', url: 'https://news.example.com/lumen-raise' })) as { ok: boolean; data: { mode: string } };
  expect(res.ok).toBe(true);
  expect(['split', 'window', 'tab']).toContain(res.data.mode);
  // Chrome 155+ splits it with the HubSpot tab; older Chrome (and headless) a window or the next tab.
  const find = () => context.pages().find((p) => p.url().startsWith('https://news.example.com/'));
  await expect.poll(() => find()?.url()).toBe('https://news.example.com/lumen-raise');
  const source = find()!;
  await expect(source).toHaveTitle('Lumen Labs raises $12M');

  // The next source reuses that tab rather than piling tabs up.
  const before = context.pages().length;
  await send({ type: 'beside.open', url: 'https://news.example.com/lumen-jobs' });
  await expect.poll(() => source.url()).toBe('https://news.example.com/lumen-jobs');
  expect(context.pages().length).toBe(before);

  // Only web pages, never extension or file URLs.
  expect(await send({ type: 'beside.open', url: 'file:///etc/hosts' })).toMatchObject({ ok: false });

  await send({ type: 'beside.close' });
  await expect.poll(() => source.isClosed()).toBe(true);
  await send({ type: 'session.end' });
  await send({ type: 'session.reset' });
  await page.close();
});

test('the Cue web app sets how the extension behaves, but never its server', async () => {
  const web = await context.newPage();
  // The bridge is registered once the worker has started; reload until it answers.
  await expect
    .poll(
      async () => {
        await web.goto('http://localhost:5173/');
        return web.evaluate(
          () =>
            new Promise<string | null>((resolve) => {
              const t = setTimeout(() => resolve(null), 800);
              window.addEventListener('message', (e) => {
                if (e.data?.source === 'cue-extension' && e.data.type === 'hello') {
                  clearTimeout(t);
                  resolve(JSON.stringify(e.data.settings));
                }
              });
              window.postMessage({ source: 'cue-web', type: 'extension.ping' }, location.origin);
            }),
        );
      },
      { timeout: 15_000 },
    )
    .toContain(serverUrl);

  await web.evaluate(() =>
    window.postMessage({ source: 'cue-web', type: 'extension.settings', patch: { direction: 'night', overlay: false, rep: { id: 'rep_sam', name: 'Sam Lee' }, serverUrl: 'https://evil.example', token: 'stolen' } }, location.origin),
  );
  await expect.poll(async () => sw.evaluate(async () => (await chrome.storage.sync.get('cue.settings'))['cue.settings'])).toMatchObject({ direction: 'night', overlay: false, rep: { id: 'rep_sam', name: 'Sam Lee' }, serverUrl });
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('cue.token'))['cue.token'] ?? '')).not.toBe('stolen');

  // The bar on HubSpot follows: hidden now.
  const page = await openContact();
  await expect(page.locator('.cue-bar')).toHaveCount(0);
  await setSettings({ direction: 'honey', overlay: true, rep: { id: 'rep_e2e', name: 'Alex Rivera' } });
  await expect(page.locator('.cue-bar').first()).toBeVisible();
  await page.close();
  await web.close();
});

test('without a reachable server the panel asks for one, and only that', async () => {
  await setSettings({ serverUrl: 'http://localhost:9' });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 800 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { name: 'Connect Cue' })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Cue server' })).toHaveValue('http://localhost:9');
  await expect(panel.locator('input')).toHaveCount(2);
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-connect.png') });
  expect(await pageOverflow(panel)).toEqual([]);
  await setSettings({ serverUrl });
  await expect(panel.locator('.sp-who__name').or(panel.getByText('Waiting for the next contact')).first()).toBeVisible();
  await panel.close();
});

test('overlay: collapsed by default in a shadow root, never blocks the page, drags, expands with a bounded panel, Esc collapses, pops out', async () => {
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
  await postTurn(await latestCallId(), 'prospect', 'Just send me an email.');
  await expect(page.locator('.cue-bar__moment').first()).toBeVisible({ timeout: 20_000 });

  // Pop out (Document Picture-in-Picture) is offered where Chrome has it.
  const pip = await page.evaluate(() => 'documentPictureInPicture' in window);
  await expect(page.getByRole('button', { name: 'Pop out' })).toHaveCount(pip ? 1 : 0);

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
  const scrolls = await panel.evaluate((el) => getComputedStyle(el).overflowY);
  expect(['auto', 'scroll']).toContain(scrolls);
  await page.screenshot({ path: join(shots, 'overlay-expanded.png') });

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
  await page.screenshot({ path: join(shots, 'overlay-live.png') });

  // Leave things clean for the next test.
  await page.evaluate(() => localStorage.removeItem('cue.overbar.x'));
  await send({ type: 'session.end' });
  await send({ type: 'session.reset' });
  await page.close();
});

test('with no contact on any page, the panel says what it is waiting for', async () => {
  for (const p of context.pages()) if (p.url().includes('hubspot.com')) await p.close();
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 800 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await expect(panel.getByText('Waiting for the next contact')).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await settle(panel);
  await panel.screenshot({ path: join(shots, 'sidepanel-waiting.png') });
  expect(await pageOverflow(panel)).toEqual([]);
  await panel.close();
});
