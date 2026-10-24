import { HOSTS, type HostId } from './hosts';
import { DEFAULT_SERVER, serverOrigin } from './manifest';

declare const __CUE_DEFAULT_SERVER__: string | undefined;

export type Direction = 'honey' | 'night' | 'signal';
export type ThemePref = 'light' | 'dark' | 'system';

export interface Settings {
  /** Cue server origin, e.g. `http://localhost:8787`. */
  serverUrl: string;
  /** The Cue web app (history, contacts, team), for "Open in Cue" links. Empty: worked out from the server. */
  webUrl: string;
  /** Shared secret sent as `x-cue-token`. Kept in storage.local (this device only), never synced. */
  token: string;
  /** Look of the side panel and the on-page overbar. */
  direction: Direction;
  theme: ThemePref;
  /** Start Cue by itself when Trellus shows a connected call (on unless turned off in the Cue app). */
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
    webUrl: '',
    token: '',
    direction: 'honey',
    theme: 'system',
    autoStart: true,
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
    webUrl: typeof r.webUrl === 'string' && /^https?:\/\//i.test(r.webUrl.trim()) ? r.webUrl.trim().replace(/\/+$/, '').slice(0, 500) : d.webUrl,
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

/** A screen in the Cue web app (hash routes such as `history`, `debrief/<id>`, `settings`), with an optional query. */
export function webAppRoute(s: Pick<Settings, 'serverUrl' | 'webUrl'>, route: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams(query).toString();
  return `${webAppUrl(s).replace(/\/+$/, '')}/#/${route}${q ? `?${q}` : ''}`;
}

/**
 * Where the Cue web app lives: the saved URL, else the dev web server beside a local Cue server
 * (:8787 → :5173), else the server's own origin (which serves the built app).
 */
export function webAppUrl(s: Pick<Settings, 'serverUrl' | 'webUrl'>): string {
  if (s.webUrl) return s.webUrl;
  try {
    const u = new URL(s.serverUrl);
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '8787') return `${u.protocol}//${u.hostname}:5173`;
    return u.origin;
  } catch {
    return s.serverUrl;
  }
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

/** What the Cue web app's Settings may change here (webapp.content.ts relays it). Never the server or token. */
export function webPatch(raw: unknown, current: Settings): Partial<Settings> | null {
  if (!isObj(raw)) return null;
  const out: Partial<Settings> = {};
  if (DIRECTIONS.includes(raw.direction as Direction)) out.direction = raw.direction as Direction;
  if (THEMES.includes(raw.theme as ThemePref)) out.theme = raw.theme as ThemePref;
  if (typeof raw.autoStart === 'boolean') out.autoStart = raw.autoStart;
  if (typeof raw.overlay === 'boolean') out.overlay = raw.overlay;
  if (isObj(raw.hosts)) {
    const hosts = { ...current.hosts };
    for (const h of HOSTS) if (typeof raw.hosts[h.id] === 'boolean') hosts[h.id] = raw.hosts[h.id] as boolean;
    out.hosts = hosts;
  }
  if (isObj(raw.rep)) {
    const id = typeof raw.rep.id === 'string' && /^[\w.:-]{1,120}$/.test(raw.rep.id) ? raw.rep.id : current.rep.id;
    const name = typeof raw.rep.name === 'string' ? raw.rep.name.trim().slice(0, 120) : current.rep.name;
    out.rep = { id, name };
  }
  return Object.keys(out).length ? out : null;
}

/** What the extension tells the web app about itself (no token, ever). */
export function publicSettings(s: Settings) {
  return { serverUrl: s.serverUrl, direction: s.direction, theme: s.theme, autoStart: s.autoStart, overlay: s.overlay, hosts: s.hosts, rep: s.rep };
}
