import { createStore } from './store';

export type Direction = 'honey' | 'night' | 'signal';
export type ThemePref = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export type TranscriberKind = 'webspeech' | 'typed';
export type DemoVariant = 'cold' | 'warm' | 'both';

export interface Settings {
  /** Empty = same origin (the dev server proxies /api and /health to @cue/server). */
  serverUrl: string;
  token: string;
  direction: Direction;
  theme: ThemePref;
  density: Density;
  transcriber: TranscriberKind;
  repName: string;
  repId: string;
  /** Read the simulated prospect's lines aloud in practice. */
  practiceVoice: boolean;
  demoVariant: DemoVariant;
  /** 1 = natural speaking pace. */
  demoSpeed: number;
  /** Fill and submit the debrief in demo mode too. */
  demoHandsFree: boolean;
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
  practiceVoice: false,
  demoVariant: 'cold',
  demoSpeed: 1,
  demoHandsFree: true,
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
  demoVariant: ['cold', 'warm', 'both'],
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
    if (key === 'demoSpeed' && (!Number.isFinite(v) || (v as number) <= 0 || (v as number) > 4)) continue;
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

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((s) => ({ ...s, ...patch }));
}
