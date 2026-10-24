import type { z } from 'zod';
import {
  errorFromResponse,
  redact,
  TrellusError,
  TrellusNetworkError,
  TrellusRateLimitError,
  TrellusRequestError,
  type TrellusEndpoint,
} from './errors';
import { createTokenBucket, realClock, TRELLUS_LIMITS, type BucketSpec, type Clock, type TokenBucket } from './rate-limit';
import {
  AudioLinks,
  Bootstrap,
  MetricRequest,
  Rows,
  SessionDetail,
  SessionListRequest,
  VisibleDirectory,
  type MetricRequest as MetricRequestT,
  type SessionListRequest as SessionListRequestT,
} from './requests';

export const TRELLUS_HOSTS = {
  /** `api_key` header. */
  ext: 'https://ext.trellus.ai',
  /** `Authorization: Bearer`. */
  rpt: 'https://rpt-2.trellus.ai',
  /** `api_key` + `session_id` headers (audio links only). */
  api: 'https://api.trellus.ai',
} as const;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TrellusClientOptions {
  apiKey: string;
  /** One permitted team per request; never expands access. */
  teamId?: string | null;
  fetch?: FetchLike;
  /** Wall clock, ms. Used with `sleep` for rate limiting and backoff. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  hosts?: Partial<typeof TRELLUS_HOSTS>;
  limits?: Partial<Record<TrellusEndpoint, BucketSpec>>;
  /** Retries after a 429 (honouring Retry-After). Default 3. */
  max429Retries?: number;
  /** Retries after 5xx or a network failure, with backoff 500 ms → 1 s → 2 s. Default 3. */
  maxTransientRetries?: number;
  /** Longest Retry-After we will wait in-process, ms; longer → throw so the caller retries later. Default 60 s. */
  maxRetryAfterMs?: number;
}

export interface TrellusClient {
  visible(): Promise<VisibleDirectory>;
  bootstrap(): Promise<Bootstrap>;
  sessionList(req: SessionListRequestT): Promise<Rows>;
  metricDetails(req: MetricRequestT): Promise<Rows>;
  session(sessionId: string): Promise<SessionDetail>;
  audioLinks(sessionId: string): Promise<AudioLinks>;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export function createTrellusClient(opts: TrellusClientOptions): TrellusClient {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) throw new Error('createTrellusClient: apiKey is empty');
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const clock: Clock = { now: opts.now ?? realClock.now, sleep: opts.sleep ?? realClock.sleep };
  const hosts = { ...TRELLUS_HOSTS, ...opts.hosts };
  const teamId = opts.teamId ?? undefined;
  const max429 = opts.max429Retries ?? 3;
  const maxTransient = opts.maxTransientRetries ?? 3;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 60_000;

  const buckets = {} as Record<TrellusEndpoint, TokenBucket>;
  for (const ep of Object.keys(TRELLUS_LIMITS) as TrellusEndpoint[]) {
    buckets[ep] = createTokenBucket(opts.limits?.[ep] ?? TRELLUS_LIMITS[ep], clock);
  }

  const iso = () => new Date(clock.now()).toISOString();

  async function call<T>(endpoint: TrellusEndpoint, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let rateLimited = 0;
    let transient = 0;
    for (;;) {
      await buckets[endpoint].take();
      let res: Response;
      try {
        res = await doFetch(url, init);
      } catch (err) {
        if (transient < maxTransient) {
          await clock.sleep(BACKOFF_MS[transient++] ?? 8000);
          continue;
        }
        const message = redact(err instanceof Error ? err.message : String(err), apiKey);
        throw new TrellusNetworkError('network', endpoint, null, message, iso());
      }

      if (res.ok) {
        let json: unknown;
        const text = await res.text();
        try {
          json = JSON.parse(text);
        } catch {
          throw new TrellusError('invalid_response', endpoint, res.status, redact(text, apiKey).slice(0, 200), iso(), `Trellus ${endpoint}: response was not JSON`);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new TrellusError('invalid_response', endpoint, res.status, parsed.error.message.slice(0, 500), iso(), `Trellus ${endpoint}: unexpected response shape`);
        }
        return parsed.data;
      }

      // Error bodies can be plain text; read them as text.
      const body = await res.text().catch(() => '');
      const err = errorFromResponse(endpoint, res.status, body, iso(), apiKey);

      if (err instanceof TrellusRateLimitError) {
        const waitMs = parseRetryAfter(res.headers.get('retry-after'), clock.now());
        err.retryAfterMs = waitMs;
        buckets[endpoint].blockUntil(clock.now() + waitMs);
        if (rateLimited < max429 && waitMs <= maxRetryAfterMs) {
          rateLimited++;
          continue; // the bucket now waits out Retry-After
        }
        throw err;
      }
      if (err.code === 'server' && transient < maxTransient) {
        await clock.sleep(BACKOFF_MS[transient++] ?? 8000);
        continue;
      }
      throw err;
    }
  }

  const keyHeaders = (): Record<string, string> => ({ api_key: apiKey });
  const bearerHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${apiKey}` });

  function validate<T>(endpoint: TrellusEndpoint, schema: z.ZodType<T>, req: unknown): T {
    const parsed = schema.safeParse(req);
    if (!parsed.success) throw new TrellusRequestError('invalid_request', endpoint, null, parsed.error.message.slice(0, 500), iso(), `Trellus ${endpoint}: invalid request`);
    return parsed.data;
  }

  function post<T>(endpoint: 'sessionList' | 'metricDetails', path: string, body: object, schema: z.ZodType<T>): Promise<T> {
    const withTeam = teamId && !('team_id' in body && body.team_id) ? { ...body, team_id: teamId } : body;
    return call(endpoint, `${hosts.rpt}${path}`, {
      method: 'POST',
      headers: { ...bearerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(withTeam),
    }, schema);
  }

  return {
    async visible() {
      const headers: Record<string, string> = keyHeaders();
      if (teamId) headers.team_id = teamId;
      return call('visible', `${hosts.ext}/visible`, { method: 'GET', headers }, VisibleDirectory);
    },
    async bootstrap() {
      return call('bootstrap', `${hosts.ext}/bootstrap`, { method: 'GET', headers: keyHeaders() }, Bootstrap);
    },
    async sessionList(req) {
      return post('sessionList', '/session-list-v6', validate('sessionList', SessionListRequest, req), Rows);
    },
    async metricDetails(req) {
      return post('metricDetails', '/metric-details-v7', validate('metricDetails', MetricRequest, req), Rows);
    },
    async session(sessionId) {
      requireId('session', sessionId, iso);
      // The id goes in a header; a query parameter or body is ignored by Trellus.
      return call('session', `${hosts.rpt}/session`, {
        method: 'GET',
        headers: { ...bearerHeaders(), 'x-session-id': sessionId, 'x-proto-as-json': 'true' },
      }, SessionDetail);
    },
    async audioLinks(sessionId) {
      requireId('audioLinks', sessionId, iso);
      return call('audioLinks', `${hosts.api}/get-audio-links`, {
        method: 'GET',
        headers: { ...keyHeaders(), session_id: sessionId },
      }, AudioLinks);
    },
  };
}

function requireId(endpoint: TrellusEndpoint, id: string, iso: () => string): void {
  if (!id || !id.trim()) throw new TrellusRequestError('invalid_request', endpoint, null, 'session id is empty', iso());
}

/** Retry-After is seconds (documented); an HTTP date is accepted too. Missing → 1 s. */
export function parseRetryAfter(header: string | null, nowMs: number): number {
  if (!header) return 1000;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return Math.max(0, Math.ceil(secs * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : 1000;
}
