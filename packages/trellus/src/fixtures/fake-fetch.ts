import { FIXTURE_BOOTSTRAP, FIXTURE_VISIBLE } from './directory';
import { FIXTURE_RECORDS, SESSION_DEFAULTS, toProtoJson, type SessionRecord } from './sessions';

/**
 * A stand-in for the Trellus Call Data API, faithful to the documented contract:
 * - auth per host (`api_key` on ext/api, `Authorization: Bearer` on rpt-2), 401 "inactive user" otherwise
 * - session-list-v6: required `start` (µs) + `select`, limit 1..1000 (default 50), cnf AND-of-OR, newest first, positional rows
 * - metric-details-v7: counts/sums per select, optional group_by (exact or stepped, with the started_at ×1e6 quirk)
 * - /session: `x-session-id` header only; JSON only with `x-proto-as-json: true` (else protobuf bytes);
 *   401 "not found" / "not permissioned" / "not on db"
 * - /get-audio-links: `api_key` + `session_id` headers; 400 for a non-call session
 * - 429 with `Retry-After` every N requests, and optionally when a documented per-user limit is exceeded
 * Error bodies are plain text, as the docs warn.
 */
export interface FakeTrellusOptions {
  apiKey?: string;
  records?: SessionRecord[];
  visible?: unknown;
  bootstrap?: unknown;
  /** Answer every Nth request (1-based, all endpoints) with 429. 0 = never. */
  rateLimitEvery?: number;
  retryAfterSeconds?: number;
  /** Return 429 when a documented per-user limit is exceeded, measured on `now`. */
  enforceLimits?: boolean;
  now?: () => number;
  /** Session ids that answer 401 "not permissioned" / "not on db". */
  forbidden?: string[];
  notOnDb?: string[];
  /** Runs first; return a Response to override the default handling (e.g. scripted 503s). */
  intercept?: (req: FakeRequest) => Response | undefined;
}

export interface FakeRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
  endpoint: string;
  at: number;
}

export interface FakeTrellusFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  calls: FakeRequest[];
  /** Status of each response, in order. */
  statuses: number[];
}

export const FIXTURE_API_KEY = 'trl_fixture_key_0123456789abcdef';

const LIMITS: Record<string, [number, number]> = {
  visible: [2, 4000],
  bootstrap: [2, 4000],
  sessionList: [2, 4000],
  metricDetails: [4, 4000],
  session: [1, 1000],
};

const ENUMS: Record<string, string[]> = {
  conversation_type: ['CONVERSATION_TYPE_UNKNOWN', 'CONVERSATION_TYPE_CALL', 'CONVERSATION_TYPE_MESSAGING', 'CONVERSATION_TYPE_CHAT'],
  address_type: ['ADDRESS_TYPE_UNKNOWN', 'ADDRESS_TYPE_PHONE', 'ADDRESS_TYPE_EMAIL', 'ADDRESS_TYPE_WEB', 'ADDRESS_TYPE_AGENT'],
};

export function createFakeTrellusFetch(opts: FakeTrellusOptions = {}): FakeTrellusFetch {
  const apiKey = opts.apiKey ?? FIXTURE_API_KEY;
  const records = opts.records ?? FIXTURE_RECORDS;
  const now = opts.now ?? Date.now;
  const known = new Set<string>([...Object.keys(SESSION_DEFAULTS), ...records.flatMap((r) => Object.keys(r))]);
  const history: Record<string, number[]> = {};
  let count = 0;

  const fake = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : null;
    const endpoint = endpointOf(url);
    const req: FakeRequest = { url, method, headers, body, endpoint, at: now() };
    fake.calls.push(req);
    const res = respond(req);
    fake.statuses.push(res.status);
    return res;
  }) as FakeTrellusFetch;
  fake.calls = [];
  fake.statuses = [];

  function respond(req: FakeRequest): Response {
    const overridden = opts.intercept?.(req);
    if (overridden) return overridden;
    count++;
    if (opts.rateLimitEvery && count % opts.rateLimitEvery === 0) return tooMany();
    if (opts.enforceLimits && LIMITS[req.endpoint]) {
      const [cap, win] = LIMITS[req.endpoint]!;
      const h = (history[req.endpoint] ??= []).filter((t) => t > req.at - win);
      history[req.endpoint] = h;
      if (h.length >= cap) return tooMany();
      h.push(req.at);
    }

    const host = req.url.hostname;
    const path = req.url.pathname;
    if (host === 'ext.trellus.ai') {
      if (req.headers.get('api_key') !== apiKey) return text(401, 'inactive user');
      if (req.method !== 'GET') return text(405, 'method not allowed');
      if (path === '/visible') return json(opts.visible ?? FIXTURE_VISIBLE);
      if (path === '/bootstrap') return json(opts.bootstrap ?? FIXTURE_BOOTSTRAP);
      return text(404, 'not found');
    }
    if (host === 'api.trellus.ai' && path === '/get-audio-links') {
      if (req.headers.get('api_key') !== apiKey) return text(401, 'inactive user');
      const id = req.headers.get('session_id');
      if (!id) return text(400, 'missing session_id header');
      const rec = records.find((r) => r.session_id === id);
      if (!rec) return text(401, 'not found');
      if (rec.conversation_type !== 'CONVERSATION_TYPE_CALL') return text(400, 'session is not a call');
      return json({
        session: { session_id: id, started_at: rec.started_at, duration: rec.duration },
        audio: [{ uploaded_key: `rec/${id}/commingled.wav`, audio_file_type: 3, start: 0 }],
        audio_links: [`https://audio.trellus.example/${id}/commingled.wav?expires=3600&sig=fixture`],
      });
    }
    if (host === 'rpt-2.trellus.ai') {
      if (req.headers.get('authorization') !== `Bearer ${apiKey}`) return text(401, 'inactive user');
      if (path === '/session') return sessionDetail(req);
      if (path === '/session-list-v6' || path === '/metric-details-v7') {
        if (req.method !== 'POST') return text(405, 'method not allowed');
        if (!(req.headers.get('content-type') ?? '').includes('application/json')) return text(400, 'expected Content-Type: application/json');
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(req.body ?? '') as Record<string, unknown>;
        } catch {
          return text(400, 'invalid JSON body');
        }
        return path === '/session-list-v6' ? sessionList(parsed) : metricDetails(parsed);
      }
      return text(404, 'not found');
    }
    return text(404, 'unknown host');
  }

  function tooMany(): Response {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': String(opts.retryAfterSeconds ?? 1), 'content-type': 'text/plain' } });
  }

  function window(body: Record<string, unknown>): { rows: SessionRecord[] } | Response {
    if (!Number.isInteger(body.start)) return text(400, 'start is required (integer Unix microseconds)');
    const start = body.start as number;
    const end = body.end === undefined ? now() * 1000 : (body.end as number);
    const cnf = (body.cnf ?? []) as unknown[];
    const err = checkCnf(cnf);
    if (err) return text(400, err);
    const rows = records.filter((r) => {
      const us = Number(r.started_at) * 1_000_000;
      return us >= start && us < end && matchesCnf(r, cnf as Cond[][]);
    });
    return { rows };
  }

  function checkCnf(cnf: unknown[]): string | null {
    if (!Array.isArray(cnf)) return 'cnf must be an array of arrays';
    for (const group of cnf) {
      if (!Array.isArray(group) || group.length === 0) return 'cnf groups must be non-empty arrays';
      for (const c of group as Cond[]) {
        if (!c || typeof c.column_name !== 'string' || !c.operator || !('value_safe' in c)) return 'filter needs column_name, operator and value_safe';
        if (!known.has(c.column_name)) return `unknown column: ${c.column_name}`;
      }
    }
    return null;
  }

  function sessionList(body: Record<string, unknown>): Response {
    const select = body.select;
    if (!Array.isArray(select) || select.length === 0) return text(400, 'select is required');
    const unknown = (select as string[]).find((c) => !known.has(c));
    if (unknown) return text(400, `unknown column: ${unknown}`);
    const limit = body.limit === undefined ? 50 : (body.limit as number);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return text(400, 'limit must be between 1 and 1000');
    const w = window(body);
    if (w instanceof Response) return w;
    const rows = [...w.rows]
      .sort((a, b) => Number(b.started_at) - Number(a.started_at))
      .slice(0, limit)
      .map((r) => (select as string[]).map((c) => r[c] ?? SESSION_DEFAULTS[c] ?? null));
    return json(rows);
  }

  function metricDetails(body: Record<string, unknown>): Response {
    const selects = body.selects as Array<{ cnf?: Cond[][]; column_name?: string }> | undefined;
    if (!Array.isArray(selects) || selects.length === 0) return text(400, 'selects is required');
    for (const s of selects) {
      if (!s || (s.cnf === undefined && s.column_name === undefined)) return text(400, 'empty aggregation');
      if (s.cnf) {
        const err = checkCnf(s.cnf);
        if (err) return text(400, err);
      }
    }
    const w = window(body);
    if (w instanceof Response) return w;
    const aggregate = (rows: SessionRecord[]) =>
      selects.map((s) => {
        const hit = s.cnf ? rows.filter((r) => matchesCnf(r, s.cnf!)) : rows;
        if (!s.column_name) return hit.length;
        return hit.reduce((sum, r) => sum + Number(r[s.column_name!] === true ? 1 : r[s.column_name!] || 0), 0);
      });
    const g = body.group_by as { column_name: string; step_size_safe?: number; step_start_safe?: number; step_modulus_safe?: number } | undefined;
    if (!g) return json([aggregate(w.rows)]);
    if (!known.has(g.column_name)) return text(400, `unknown column: ${g.column_name}`);
    const groups = new Map<unknown, SessionRecord[]>();
    for (const r of w.rows) {
      let key: unknown = r[g.column_name];
      if (g.step_size_safe !== undefined) {
        let v = Number(key) - (g.step_start_safe ?? 0);
        if (g.step_modulus_safe) v = ((v % g.step_modulus_safe) + g.step_modulus_safe) % g.step_modulus_safe;
        key = Math.floor(v / g.step_size_safe);
        if (g.column_name === 'started_at') key = (key as number) * 1_000_000; // documented compatibility quirk
      }
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return json([...groups].map(([key, rows]) => [key, ...aggregate(rows)]));
  }

  function sessionDetail(req: FakeRequest): Response {
    if (req.method !== 'GET') return text(405, 'method not allowed');
    // A query parameter is ignored: only the header selects the session.
    const id = req.headers.get('x-session-id');
    const rec = id ? records.find((r) => r.session_id === id) : undefined;
    if (!id || !rec) return text(401, 'not found');
    if (opts.forbidden?.includes(id)) return text(401, 'not permissioned');
    if (opts.notOnDb?.includes(id)) return text(401, 'not on db');
    if (req.headers.get('x-proto-as-json') !== 'true') {
      return new Response(new Uint8Array([0x0a, id.length, ...new TextEncoder().encode(id)]), { status: 200, headers: { 'content-type': 'application/x-protobuf' } });
    }
    return json(toProtoJson(rec));
  }

  return fake;
}

interface Cond {
  column_name: string;
  operator: string;
  value_safe: unknown;
}

function matchesCnf(r: SessionRecord, cnf: Cond[][]): boolean {
  return cnf.every((group) => group.some((c) => matches(r, c)));
}

function enumValue(column: string, v: unknown): unknown {
  const names = ENUMS[column];
  if (!names) return v;
  if (typeof v === 'number') return v;
  const i = names.indexOf(String(v));
  return i >= 0 ? i : v;
}

function matches(r: SessionRecord, c: Cond): boolean {
  const actual = enumValue(c.column_name, r[c.column_name] ?? SESSION_DEFAULTS[c.column_name]);
  const want = Array.isArray(c.value_safe) ? c.value_safe.map((v) => enumValue(c.column_name, v)) : enumValue(c.column_name, c.value_safe);
  const a = actual as number;
  const w = want as number;
  switch (c.operator) {
    case 'EQ':
      return actual === want;
    case 'NEQ':
      return actual !== want;
    case 'GT':
      return a > w;
    case 'GE':
      return a >= w;
    case 'LT':
      return a < w;
    case 'LE':
      return a <= w;
    case 'IN':
      return Array.isArray(want) && want.includes(actual);
    case 'NIN':
      return Array.isArray(want) && !want.includes(actual);
    case 'REGEX':
      return typeof actual === 'string' && new RegExp(String(want)).test(actual);
    default:
      return false;
  }
}

function endpointOf(url: URL): string {
  switch (url.pathname) {
    case '/visible':
      return 'visible';
    case '/bootstrap':
      return 'bootstrap';
    case '/session-list-v6':
      return 'sessionList';
    case '/metric-details-v7':
      return 'metricDetails';
    case '/session':
      return 'session';
    case '/get-audio-links':
      return 'audioLinks';
    default:
      return 'other';
  }
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
