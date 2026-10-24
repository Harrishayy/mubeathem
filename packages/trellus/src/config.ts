/** Server-side Trellus settings, read from the environment (see /.env.example). */
export interface TrellusConfig {
  apiKey: string | null;
  teamId: string | null;
  /** How often to poll for dispositions of finished calls, seconds. 0 disables polling. */
  pollSeconds: number;
  /** True when a key is present; with no key the server runs Cue native. */
  configured: boolean;
}

export const DEFAULT_POLL_SECONDS = 60;
/** Never poll faster than the session-list budget allows (2 requests per 4 s, shared). */
export const MIN_POLL_SECONDS = 5;

export function loadTrellusConfig(env: Record<string, string | undefined> = process.env): TrellusConfig {
  const apiKey = clean(env.TRELLUS_API_KEY);
  const teamId = clean(env.TRELLUS_TEAM_ID);
  return { apiKey, teamId, pollSeconds: parsePollSeconds(env.TRELLUS_POLL_SECONDS), configured: apiKey !== null };
}

function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function parsePollSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_POLL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_POLL_SECONDS;
  if (n === 0) return 0;
  return Math.max(MIN_POLL_SECONDS, Math.round(n));
}
