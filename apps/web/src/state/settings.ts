import { createStore } from './store';

export type Direction = 'honey' | 'night' | 'signal';
export type ThemePref = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export type TranscriberKind = 'webspeech' | 'typed';

export interface Settings {
  /** Empty = same origin (the dev server proxies /api and /health to @cue/server). */
  serverUrl: string;
  token: string;
  direction: Direction;
  theme: ThemePref;
  density: Density;
  transcriber: TranscriberKind;
  repName: string;
  /** Who you are on the team: your calls, your numbers on Team. Empty until you set your name. */
  repId: string;
  /** The first-run hint on Live has been dismissed. */
  seenLiveHint: boolean;
  /** Show servedBy / latency on cards. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: (import.meta.env?.VITE_CUE_SERVER as string | undefined) ?? '',
  token: '',
  direction: 'honey',
  theme: 'system',
  density: 'comfortable',
  transcriber: 'webspeech',
  repName: 'Alex Rivera',
  repId: 'rep_alex',
  seenLiveHint: false,
  debug: false,
};

export const SETTINGS_KEY = 'cue.settings.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  direction: ['honey', 'night', 'signal'],
  theme: ['light', 'dark', 'system'],
  density: ['comfortable', 'compact'],
  transcriber: ['webspeech', 'typed'],
};

/** Reads persisted settings, keeping only fields with the right type. Never throws. */
export function loadSettings(storage: StorageLike | null = safeStorage()): Settings {
  let raw: unknown = null;
  try {
    const s = storage?.getItem(SETTINGS_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = r[key];
    const d = DEFAULT_SETTINGS[key];
    if (v === undefined || typeof v !== typeof d) continue;
    if (ENUMS[key] && !ENUMS[key]!.includes(v as string)) continue;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** Persists settings. Returns false when storage is blocked or full (settings then live for this tab only). */
export function saveSettings(s: Settings, storage: StorageLike | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const settingsStore = createStore<Settings>(loadSettings());
settingsStore.subscribe(() => saveSettings(settingsStore.get()));

/** `Sam O'Neil` → `rep_sam_o_neil`: a stable id for a typed name (empty name → no id). */
export function repIdFor(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug ? `rep_${slug}` : '';
}

/** First name for buttons ("Call Maya"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((s) => ({ ...s, ...patch }));
}
