import { CONTENT_MATCHES } from './hosts';

export const DEFAULT_SERVER = 'http://localhost:8787';

/** Normalises a server origin (`http://host:port`), falling back to the local dev server. */
export function serverOrigin(raw: string | undefined): string {
  if (!raw) return DEFAULT_SERVER;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_SERVER;
    return u.origin;
  } catch {
    return DEFAULT_SERVER;
  }
}

/** The Cue web app in development (the server origin serves the built app and is covered already). */
export const WEBAPP_DEV_MATCHES = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*'];

/** Where the web-app bridge runs: the dev web app, the server's own origin and a separately hosted app. */
export function webAppMatches(server: string, webUrl = ''): string[] {
  const out = new Set([...WEBAPP_DEV_MATCHES, `${serverOrigin(server)}/*`]);
  if (webUrl) {
    try {
      const u = new URL(webUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(`${u.origin}/*`);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

export const COMMANDS = {
  'toggle-overbar': { suggested_key: { default: 'Alt+Shift+C' }, description: 'Show or hide the Cue overbar' },
  'mark-booked': { suggested_key: { default: 'Alt+Shift+B' }, description: 'Mark this call as booked' },
} as const;

/**
 * The manifest fields WXT doesn't derive from entrypoints. WXT adds `background`, `side_panel`,
 * `content_scripts` and the offscreen page itself.
 *
 * Permissions, and why:
 * - sidePanel: Cue's expanded view docks beside the dialer.
 * - storage: settings (sync), the session and the offline turn buffer (session/local).
 * - tabCapture: the prospect's voice is the calling tab's audio.
 * - offscreen: MV3 service workers have no DOM; capture and speech run in an offscreen document.
 * - activeTab: tab capture needs the rep to have invoked Cue on that tab (icon, shortcut).
 * - scripting: re-inject the overlay into CRM tabs that were open before install or update, and
 *   register the bridge on the Cue web app (its settings drive the extension).
 * - contextMenus: right-click a link to open it beside the call, or a name to find it in Cue.
 * - notifications: the outcome Trellus logs after the call, to confirm in one click.
 * - host_permissions: the CRM/dialer pages the overlay reads, the Cue server and the web app.
 *
 * No permission is needed for Split View (tabs.create({ splitWithTabId }), Chrome 155+) or the
 * omnibox keyword ("cue" in the address bar searches contacts and past calls).
 * - optional_host_permissions: a self-hosted Cue server, granted when chosen in Settings.
 */
export function buildManifest(server: string) {
  return {
    name: 'Cue',
    short_name: 'Cue',
    description: 'Know exactly what to say next on every cold call. Live lines beside your dialer, learned from what books meetings.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'tabCapture', 'offscreen', 'activeTab', 'scripting', 'contextMenus', 'notifications'],
    host_permissions: [...CONTENT_MATCHES, `${server}/*`],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Open Cue' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    commands: COMMANDS,
    omnibox: { keyword: 'cue' },
  };
}
