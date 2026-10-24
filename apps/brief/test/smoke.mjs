// Smoke test for the Corgi Cue extension in real Chromium: a HubSpot page with a Trellus dialer
// (cards inside an open shadow root, as Trellus renders them) flips a card to connected; the
// extension must start a call on a local Cue server (live pipeline, no keys, so no model spend),
// put the panel's live section on screen, and end the call when the card disconnects.
//
//   node apps/brief/test/smoke.mjs        (needs `pnpm i`; uses Playwright's Chromium)

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '..');
const serverDir = resolve(here, '../../server');
const shots = resolve(here, '../../../test-results/brief');

const FIXTURE = `<!doctype html><html><head><title>Maya Chen | HubSpot</title></head><body>
<div id="hs">Contact record</div>
<div id="dialer"><template shadowrootmode="open">
  <div class="card" data-status="ringing">
    <span class="name-text">Maya Chen</span>
    <span class="title">CEO - Lumen Labs</span>
    <span class="custom-tag__value">maya@lumenlabs.ai</span>
  </div>
</template></div>
<script>
  // Trellus flips the card's own state; HubSpot mutates the light DOM all the time, which is what wakes observers.
  window.setStatus = s => {
    document.getElementById('dialer').shadowRoot.querySelector('.card').setAttribute('data-status', s);
    document.getElementById('hs').appendChild(document.createElement('span'));
  };
</script></body></html>`;

/** Playwright's own Chromium if installed, else the newest one already in the cache (no download). */
function chromiumPath() {
  if (process.env.CUE_E2E_CHROMIUM) return process.env.CUE_E2E_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  for (const dir of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'AppData', 'Local', 'ms-playwright'), join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')]) {
    if (!dir || !existsSync(dir)) continue;
    const builds = readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds)
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'])
        if (existsSync(join(dir, b, rel))) return join(dir, b, rel);
  }
  return undefined;
}

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => (a ? res(a.port) : rej(new Error('no port')))); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { throw new Error(msg); };

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'corgi-cue-smoke-'));
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: { ...process.env, MUBIT_API_KEY: '', DEEPGRAM_API_KEY: '', EXA_API_KEY: '', CUE_API_TOKEN: 'smoke', CUE_PIPELINE: 'live', CUE_PORT: String(port), CUE_DB_PATH: join(tmp, 'cue.db'), CUE_ALLOWED_ORIGINS: 'chrome-extension://*', TRELLUS_POLL_SECONDS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', d => (log += d));
  server.stderr.on('data', d => (log += d));
  const ctx = { server, tmp };
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(url + '/health')).ok) break; } catch {} await sleep(250); }

    const browser = await chromium.launchPersistentContext(join(tmp, 'profile'), {
      channel: 'chromium',
      executablePath: chromiumPath(),
      headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    });
    ctx.browser = browser;
    const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    // Point the extension at the local server. Research keys are set to invalid values (an empty one
    // would fall back to the real keys in config.js), so the smoke test never spends on Exa or Gemini.
    await sw.evaluate(async u => { await chrome.storage.local.set({ cueServer: u, cueToken: 'smoke', exaKey: 'smoke-invalid', geminiKey: 'smoke-invalid', yourName: 'Nick' }); }, url);

    await browser.route('https://app.hubspot.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }));
    const page = await browser.newPage();
    await page.goto('https://app.hubspot.com/contacts/1/record/0-1/2');
    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);

    await sleep(500);
    await page.evaluate(() => window.setStatus('connected'));
    await panel.locator('#live .co').filter({ hasText: 'Live' }).waitFor({ timeout: 15000 });
    const calls = await (await fetch(url + '/api/calls', { headers: { 'x-cue-token': 'smoke' } })).json();
    if (!calls.length) fail('no call was created on the server');
    const call = calls[0];
    if (call.prospect.name !== 'Maya Chen' || call.prospect.company !== 'Lumen Labs') fail('wrong prospect: ' + JSON.stringify(call.prospect));
    if (call.source !== 'trellus') fail('source should be trellus');
    console.log('ok  connected card → call', call.id, 'for', call.prospect.name, '@', call.prospect.company);

    // A prospect turn arrives (as the offscreen transcriber would post it): the panel follows the stream.
    await fetch(`${url}/api/calls/${call.id}/turns`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cue-token': 'smoke' }, body: JSON.stringify({ speaker: 'prospect', text: "What's this regarding?", final: true, via: 'deepgram' }) });
    await panel.locator('#live').getByRole('button', { name: 'Transcript' }).click();
    await panel.locator('#live .tx').getByText("What's this regarding?").waitFor({ timeout: 10000 });
    await panel.locator('#live').getByText('no Mubit key').waitFor({ timeout: 10000 });
    console.log('ok  transcript and the live card area follow the call over SSE');
    await panel.screenshot({ path: join(shots, 'live.png') });

    await page.evaluate(() => window.setStatus('ended'));
    await panel.getByRole('button', { name: 'Booked' }).waitFor({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Booked' }).click();
    await panel.getByText('Logged: Booked').waitFor({ timeout: 10000 });
    for (let i = 0; i < 40; i++) {
      const v = await (await fetch(`${url}/api/calls/${call.id}`, { headers: { 'x-cue-token': 'smoke' } })).json();
      if (v.outcome && v.outcome.outcome === 'meeting_booked' && v.status !== 'live') { console.log('ok  disconnect ended the call; outcome', v.outcome.outcome, '· status', v.status); break; }
      if (i === 39) fail('outcome not recorded');
      await sleep(250);
    }
    await panel.screenshot({ path: join(shots, 'after.png') });

    // Render check: a scripted stream with a live card, so the card itself is seen on screen.
    const t0 = Date.now() - 74_000;
    const card = { id: 'sug_1', callId: 'call_r', turnId: 'turn_p2', say: "Honestly? Insurance. Worst cold-call topic there is. Give me thirty seconds on your E&O and I'll let you go.", why: 'Cold and clipped: the self-aware line wins here', lineId: 'line_seed_wtr_selfaware', evidence: { text: '2.1× the straight answer with cold CEOs · 41 calls', calls: 41, basis: 'bandit' }, upNext: [{ ifTheySay: 'We already have a broker', move: 'Ask when they last re-quoted after the raise', moment: 'objection_broker' }, { ifTheySay: 'Fine, go on', move: 'One line on E&O for enterprise contracts', moment: 'opener' }], kind: 'line', createdAt: t0 + 70_000, latencyMs: 412, servedBy: 'mubit', mubitRequestIds: [], situation: { persona: 'ceo', personaConfidence: 0.8, receptivity: 'cold', receptivityScore: -1, moment: 'whats_this_regarding', momentConfidence: 0.8, tone: { engagement: 0, warmth: 0, patience: 0, interest: 0 }, signals: [], shouldSuggest: true, rationale: 'Guarded, wants the point fast before deciding to hang up' } };
    const turns = [{ id: 'turn_r1', speaker: 'rep', text: "Hey Maya, this is Nick from Corgi. I'll be honest, this is a cold call, but a researched one.", tMs: 60_000, final: true, via: 'deepgram' }, { id: 'turn_p2', speaker: 'prospect', text: "...yeah. What's this regarding.", tMs: 68_000, final: true, via: 'deepgram' }];
    const view = { id: 'call_r', status: 'live', startedAt: t0, turns, current: card, history: [{ suggestion: card, action: null }], situation: card.situation, review: null };
    const fake = createHttp((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
      res.write(`event: view
id: 1
data: ${JSON.stringify({ kind: 'view', view })}

`);
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const furl = `http://127.0.0.1:${fake.address().port}`;
    await sw.evaluate(async ({ furl, t0 }) => {
      /* global Cue */
      await Cue.dismiss();
      await chrome.storage.local.set({ cueServer: furl });
      // The session as the worker would hold it mid-call; it is read back on the panel's next request.
      await chrome.storage.session.set({ cueSession: { status: 'live', callId: 'call_r', startedAt: t0, co: { key: 'lumenlabs.ai', name: 'Lumen Labs', person: 'Maya Chen' }, capture: { tab: { state: 'on' }, mic: { state: 'on' } } } });
    }, { furl, t0 });
    const panel2 = await browser.newPage();
    await panel2.setViewportSize({ width: 380, height: 720 });
    await panel2.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel2.locator('#live .say').waitFor({ timeout: 10000 });
    await panel2.locator('#live').getByRole('button', { name: 'Transcript' }).click();
    await panel2.screenshot({ path: join(shots, 'card.png') });
    fake.close();
    console.log('ok  a live card renders (screenshot card.png)');
    console.log('screenshots in', shots);
  } catch (e) {
    console.error('FAIL', e.message);
    console.error(log.split('\n').slice(-15).join('\n'));
    process.exitCode = 1;
  } finally {
    await ctx.browser?.close().catch(() => {});
    server.kill();
    await sleep(300);
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

await main();
