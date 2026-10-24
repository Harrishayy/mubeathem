import { HOSTS, type HostId } from './hosts';
import { DEFAULT_SERVER, serverOrigin } from './manifest';

declare const __CUE_DEFAULT_SERVER__: string | undefined;

export type Direction = 'honey' | 'night' | 'signal';
export type ThemePref = 'light' | 'dark' | 'system';

export interface Settings {
  /** Cue server origin, e.g. `http://localhost:8787`. */
  serverUrl: string;
  /** Shared secret sent as `x-cue-token`. Kept in storage.local (this device only), never synced. */
  token: string;
  /** Look of the side panel. The on-page overbar is always Night Shift (it floats over any page). */
  direction: Direction;
  theme: ThemePref;
  /** Start Cue by itself when Trellus shows a connected call. */
  autoStart: boolean;
  /** Which hosts show the overbar. */
  hosts: Record<HostId, boolean>;
  /** Show the overbar on the page at all (Alt+Shift+C toggles it). */
  overlay: boolean;
  rep: { id: string; name: string };
}

/** The Trellus API key is deliberately absent: it is posted to the server once and never stored here. */
export type SyncedSettings = Omit<Settings, 'token'>;

export function defaultServer(): string {
  return serverOrigin(typeof __CUE_DEFAULT_SERVER__ === 'string' ? __CUE_DEFAULT_SERVER__ : DEFAULT_SERVER);
}

export function defaultSettings(): Settings {
  return {
    serverUrl: defaultServer(),
    token: '',
    direction: 'honey',
    theme: 'system',
    autoStart: false,
    hosts: Object.fromEntries(HOSTS.map((h) => [h.id, true])) as Record<HostId, boolean>,
    overlay: true,
    rep: { id: '', name: '' },
  };
}

const SYNC_KEY = 'cue.settings';
const TOKEN_KEY = 'cue.token';
const REP_ID_KEY = 'cue.repId';
const DIRECTIONS: Direction[] = ['honey', 'night', 'signal'];
const THEMES: ThemePref[] = ['light', 'dark', 'system'];

/** The subset of chrome.storage.StorageArea used here; injectable for tests. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SettingsStores {
  sync: StorageAreaLike;
  local: StorageAreaLike;
}

export function chromeStores(): SettingsStores {
  return { sync: chrome.storage.sync, local: chrome.storage.local };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Merges whatever is stored over the defaults, field by field, so a bad or old value never breaks Cue. */
export function normaliseSettings(raw: unknown, token: unknown): Settings {
  const d = defaultSettings();
  const r = isObj(raw) ? raw : {};
  const hosts = { ...d.hosts };
  if (isObj(r.hosts)) for (const h of HOSTS) if (typeof r.hosts[h.id] === 'boolean') hosts[h.id] = r.hosts[h.id] as boolean;
  const rep = isObj(r.rep) ? r.rep : {};
  return {
    serverUrl: typeof r.serverUrl === 'string' && r.serverUrl.trim() ? serverOrigin(r.serverUrl.trim()) : d.serverUrl,
    token: typeof token === 'string' ? token : '',
    direction: DIRECTIONS.includes(r.direction as Direction) ? (r.direction as Direction) : d.direction,
    theme: THEMES.includes(r.theme as ThemePref) ? (r.theme as ThemePref) : d.theme,
    autoStart: typeof r.autoStart === 'boolean' ? r.autoStart : d.autoStart,
    hosts,
    overlay: typeof r.overlay === 'boolean' ? r.overlay : d.overlay,
    rep: {
      id: typeof rep.id === 'string' && rep.id ? rep.id.slice(0, 120) : d.rep.id,
      name: typeof rep.name === 'string' ? rep.name.slice(0, 120) : d.rep.name,
    },
  };
}

export async function loadSettings(stores: SettingsStores = chromeStores()): Promise<Settings> {
  try {
    const [s, l] = await Promise.all([stores.sync.get(SYNC_KEY), stores.local.get([TOKEN_KEY, REP_ID_KEY])]);
    const settings = normaliseSettings(s[SYNC_KEY], l[TOKEN_KEY]);
    if (!settings.rep.id) {
      // A stable rep id per install, so the server can group this rep's calls. Written to its own
      // key: rewriting the whole settings object here could race a save from another surface.
      let id = typeof l[REP_ID_KEY] === 'string' ? (l[REP_ID_KEY] as string) : '';
      if (!id) {
        id = `rep_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await stores.local.set({ [REP_ID_KEY]: id });
      }
      settings.rep.id = id;
    }
    return settings;
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(next: Settings, stores: SettingsStores = chromeStores()): Promise<void> {
  const { token, ...synced } = normaliseSettings(next, next.token);
  await Promise.all([stores.sync.set({ [SYNC_KEY]: synced satisfies SyncedSettings }), stores.local.set({ [TOKEN_KEY]: token })]);
}

export async function updateSettings(patch: Partial<Settings>, stores: SettingsStores = chromeStores()): Promise<Settings> {
  const next = { ...(await loadSettings(stores)), ...patch };
  await saveSettings(next, stores);
  return normaliseSettings(next, next.token);
}

/** Calls `cb` whenever settings change anywhere (another device, the side panel, the background). */
export function watchSettings(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (SYNC_KEY in changes || TOKEN_KEY in changes) void loadSettings().then(cb);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const SETTINGS_KEYS = { sync: SYNC_KEY, token: TOKEN_KEY } as const;
