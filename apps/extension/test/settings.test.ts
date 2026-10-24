import { describe, expect, it } from 'vitest';
import { HOSTS } from '../src/hosts';
import { DEFAULT_SERVER, serverOrigin } from '../src/manifest';
import { defaultSettings, loadSettings, normaliseSettings, saveSettings, SETTINGS_KEYS, webAppUrl, type StorageAreaLike } from '../src/settings';

function area(fail = false): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      if (fail) throw new Error('storage unavailable');
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      if (fail) throw new Error('storage unavailable');
      Object.assign(data, JSON.parse(JSON.stringify(items)));
    },
  };
}

describe('settings', () => {
  it('has sensible defaults', () => {
    const d = defaultSettings();
    expect(d.serverUrl).toBe(DEFAULT_SERVER);
    expect(d.token).toBe('');
    expect(d.direction).toBe('honey');
    expect(d.theme).toBe('system');
    expect(d.autoStart).toBe(true);
    expect(d.overlay).toBe(true);
    expect(Object.keys(d.hosts).sort()).toEqual(HOSTS.map((h) => h.id).sort());
    expect(Object.values(d.hosts).every(Boolean)).toBe(true);
  });

  it('repairs bad or old stored values field by field', () => {
    const s = normaliseSettings({ serverUrl: 'ftp://nope', direction: 'neon', theme: 'dark', autoStart: 'yes', hosts: { hubspot: false, bogus: true }, rep: { name: 'A'.repeat(500) } }, 42);
    expect(s.serverUrl).toBe(DEFAULT_SERVER);
    expect(s.direction).toBe('honey');
    expect(s.theme).toBe('dark');
    expect(s.autoStart).toBe(true);
    expect(s.hosts.hubspot).toBe(false);
    expect(s.hosts.apollo).toBe(true);
    expect(s.token).toBe('');
    expect(s.rep.name).toHaveLength(120);
    expect(normaliseSettings(null, undefined)).toEqual(defaultSettings());
  });

  it('normalises server URLs to an origin', () => {
    expect(serverOrigin('https://cue.example.com/api/')).toBe('https://cue.example.com');
    expect(serverOrigin('http://10.0.0.4:8787')).toBe('http://10.0.0.4:8787');
    expect(serverOrigin('not a url')).toBe(DEFAULT_SERVER);
    expect(serverOrigin(undefined)).toBe(DEFAULT_SERVER);
  });

  it('syncs preferences, keeps the token on this device, and never stores a Trellus key', async () => {
    const stores = { sync: area(), local: area() };
    await saveSettings({ ...defaultSettings(), serverUrl: 'https://cue.example.com', token: 'tok_123', rep: { id: 'rep_x', name: 'Alex' } }, stores);
    expect(JSON.stringify(stores.sync.data)).not.toContain('tok_123');
    expect(stores.local.data[SETTINGS_KEYS.token]).toBe('tok_123');
    const all = JSON.stringify([stores.sync.data, stores.local.data]).toLowerCase();
    // Hosts include a `trellus` toggle; what must never appear is a key field.
    expect(all).not.toMatch(/apikey|api_key|trelluskey/);
    const back = await loadSettings(stores);
    expect(back).toMatchObject({ serverUrl: 'https://cue.example.com', token: 'tok_123', rep: { id: 'rep_x', name: 'Alex' } });
  });

  it('gives each install a stable rep id', async () => {
    const stores = { sync: area(), local: area() };
    const a = await loadSettings(stores);
    const b = await loadSettings(stores);
    expect(a.rep.id).toMatch(/^rep_[0-9a-f]{16}$/);
    expect(b.rep.id).toBe(a.rep.id);
  });

  it('falls back to defaults when storage throws', async () => {
    expect(await loadSettings({ sync: area(true), local: area(true) })).toEqual(defaultSettings());
  });

  it('finds the web app from the saved URL, or beside the server', () => {
    expect(webAppUrl({ serverUrl: 'http://localhost:8787', webUrl: '' })).toBe('http://localhost:5173');
    expect(webAppUrl({ serverUrl: 'https://cue.example.com', webUrl: '' })).toBe('https://cue.example.com');
    expect(webAppUrl({ serverUrl: 'http://localhost:8787', webUrl: 'https://app.example.com' })).toBe('https://app.example.com');
    expect(normaliseSettings({ webUrl: 'javascript:alert(1)' }, '').webUrl).toBe('');
    expect(normaliseSettings({ webUrl: 'https://app.example.com/' }, '').webUrl).toBe('https://app.example.com');
  });
});
