import { settingsStore, type Direction, type ThemePref } from './settings';
import { createStore } from './store';

/**
 * The Cue Chrome extension, seen from the web app. The extension keeps no settings screen of its
 * own: its bridge (a content script on this origin) says hello with what it is set to, and this app
 * sends it the changes. Your name and the look follow this app's settings by themselves; the rest is
 * the "Chrome extension" section in Settings. The server and the token are never sent.
 */

export type ExtensionHost = 'hubspot' | 'trellus' | 'salesloft' | 'outreach' | 'apollo';

export interface ExtensionSettings {
  serverUrl: string;
  direction: Direction;
  theme: ThemePref;
  autoStart: boolean;
  overlay: boolean;
  hosts: Record<ExtensionHost, boolean>;
  rep: { id: string; name: string };
}

export type ExtensionPatch = Partial<Pick<ExtensionSettings, 'direction' | 'theme' | 'autoStart' | 'overlay' | 'hosts'>> & { rep?: Partial<ExtensionSettings['rep']> };

export interface ExtensionState {
  /** Null until the extension answers (or for good, when it isn't installed in this browser). */
  version: string | null;
  settings: ExtensionSettings | null;
}

export const extensionStore = createStore<ExtensionState>({ version: null, settings: null });

export const EXTENSION_HOSTS: { id: ExtensionHost; label: string }[] = [
  { id: 'hubspot', label: 'HubSpot' },
  { id: 'trellus', label: 'Trellus' },
  { id: 'salesloft', label: 'Salesloft' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'apollo', label: 'Apollo' },
];

function post(msg: Record<string, unknown>): void {
  try {
    window.postMessage({ source: 'cue-web', ...msg }, location.origin);
  } catch {
    /* no window (tests, SSR) */
  }
}

/** Sends a change to the extension; it answers with its new state. No-op when it isn't installed. */
export function updateExtension(patch: ExtensionPatch): void {
  if (!extensionStore.get().version) return;
  post({ type: 'extension.settings', patch });
}

let started = false;

/** Listens for the extension and keeps its name and look in step with this app. Call once at start. */
export function connectExtension(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { source?: unknown; type?: unknown; version?: unknown; settings?: unknown } | null;
    if (!d || d.source !== 'cue-extension' || d.type !== 'hello' || typeof d.version !== 'string') return;
    const first = !extensionStore.get().version;
    extensionStore.set({ version: d.version, settings: d.settings as ExtensionSettings });
    if (first) sync();
  });
  // The bridge runs at document_start and says hello by itself; ask again in case this loaded first.
  post({ type: 'extension.ping' });
  let last = pick();
  settingsStore.subscribe(() => {
    const next = pick();
    if (next.direction !== last.direction || next.theme !== last.theme || next.repId !== last.repId || next.repName !== last.repName) {
      last = next;
      sync();
    }
  });
}

const pick = () => {
  const s = settingsStore.get();
  return { direction: s.direction, theme: s.theme, repId: s.repId, repName: s.repName };
};

/** Your name and the look, from this app's settings to the extension. */
function sync(): void {
  const s = settingsStore.get();
  const ext = extensionStore.get().settings;
  if (!ext) return;
  const patch: ExtensionPatch = {};
  if (ext.direction !== s.direction) patch.direction = s.direction;
  if (ext.theme !== s.theme) patch.theme = s.theme;
  if (s.repId && (ext.rep.id !== s.repId || ext.rep.name !== s.repName)) patch.rep = { id: s.repId, name: s.repName };
  if (Object.keys(patch).length) updateExtension(patch);
}
