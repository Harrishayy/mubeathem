import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_MATCHES } from '../src/hosts';
import { buildManifest, COMMANDS, DEFAULT_SERVER, webAppMatches } from '../src/manifest';

const root = join(__dirname, '..');
const out = join(root, '.output', 'chrome-mv3');

describe('manifest (source)', () => {
  const m = buildManifest(DEFAULT_SERVER);
  it('asks for exactly the permissions the brief lists', () => {
    expect([...m.permissions].sort()).toEqual(['activeTab', 'contextMenus', 'notifications', 'offscreen', 'scripting', 'sidePanel', 'storage', 'tabCapture']);
    expect(m.omnibox.keyword).toBe('cue');
  });
  it('runs the settings bridge only on the Cue web app', () => {
    expect(webAppMatches('http://localhost:8787')).toEqual(['http://localhost:5173/*', 'http://127.0.0.1:5173/*', 'http://localhost:8787/*']);
    expect(webAppMatches('https://cue.example.com', 'https://app.cue.example.com/team')).toContain('https://app.cue.example.com/*');
    expect(webAppMatches('https://cue.example.com', 'javascript:alert(1)')).toHaveLength(3);
  });
  it('covers the dialer hosts and the server', () => {
    for (const h of ['*://*.hubspot.com/*', '*://*.trellus.ai/*', '*://app.trellus.ai/*', '*://*.salesloft.com/*', '*://*.outreach.io/*', '*://*.apollo.io/*']) expect(m.host_permissions).toContain(h);
    expect(m.host_permissions).toContain('http://localhost:8787/*');
    expect(buildManifest('https://cue.example.com').host_permissions).toContain('https://cue.example.com/*');
  });
  it('binds the two shortcuts', () => {
    expect(COMMANDS['toggle-overbar'].suggested_key.default).toBe('Alt+Shift+C');
    expect(COMMANDS['mark-booked'].suggested_key.default).toBe('Alt+Shift+B');
  });
});

describe('built extension (.output/chrome-mv3)', () => {
  beforeAll(() => {
    // The build takes about a second; run it when the output is missing so this never silently skips.
    if (!existsSync(join(out, 'manifest.json'))) execFileSync(join(root, 'node_modules', '.bin', 'wxt'), ['build'], { cwd: root, stdio: 'ignore' });
  }, 120_000);

  const manifest = () => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));

  it('is a valid MV3 manifest whose every referenced file exists', () => {
    const m = manifest();
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe('Cue');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.background.service_worker).toBeTruthy();
    expect(m.side_panel.default_path).toBe('sidepanel.html');
    const files = [m.background.service_worker, m.side_panel.default_path, 'offscreen.html', 'permission.html', ...Object.values<string>(m.icons), ...m.content_scripts.flatMap((c: { js: string[] }) => c.js)];
    for (const f of files) expect(existsSync(join(out, f)), f).toBe(true);
    for (const r of m.web_accessible_resources.flatMap((w: { resources: string[] }) => w.resources)) expect(existsSync(join(out, r)), r).toBe(true);
  });

  it('injects the overlay on every dialer host, in all frames (Trellus iframes)', () => {
    const [cs] = manifest().content_scripts;
    expect([...cs.matches].sort()).toEqual([...CONTENT_MATCHES].sort());
    expect(cs.all_frames).toBe(true);
  });

  it('keeps permissions as declared', () => {
    const m = manifest();
    expect([...m.permissions].sort()).toEqual(['activeTab', 'contextMenus', 'notifications', 'offscreen', 'scripting', 'sidePanel', 'storage', 'tabCapture']);
    expect(m.omnibox.keyword).toBe('cue');
    // The web-app bridge is registered at runtime, never injected everywhere; its dev origin is a host permission.
    expect(m.content_scripts.flatMap((c: { js: string[] }) => c.js)).not.toContain('content-scripts/webapp.js');
    expect(existsSync(join(out, 'content-scripts', 'webapp.js'))).toBe(true);
    expect(m.host_permissions).toContain('http://localhost:5173/*');
    expect(m.commands['toggle-overbar']).toBeTruthy();
    expect(m.minimum_chrome_version).toBe('116');
  });
});
