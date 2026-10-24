import {
  AddTurnResponse,
  ApiError,
  CallRecord,
  CallSummary,
  CallView,
  Contact,
  ContactImportResponse,
  ContactListResponse,
  HealthResponse,
  TeamResponse,
  ResearchWarmResponse,
  type ResearchWarmRequest,
  InsightsResponse,
  TraceDetail,
  TraceListResponse,
  PlaybookLine,
  PlaybookResponse,
  PracticeNextResponse,
  StatsResponse,
  SttTokenResponse,
  TrellusDispositionsResponse,
  TrellusStatusResponse,
  TrellusSyncResponse,
  AddTurnRequest,
  CreateCallRequest,
  FeedbackRequest,
  type CallListQuery,
  type ContactInput,
  type ContactListQuery,
  type TeamQuery,
  type EndCallRequest,
  type SuggestionActionRequest,
  type TrellusDispositionsRequest,
  type TrellusKeyRequest,
  type TaskId,
  type TraceExportFormat,
  type TraceRange,
} from '@cue/core';
import type { z } from 'zod';

/**
 * Typed client for the Cue server (architecture.md §5). Browser-safe: `fetch` only, no Node APIs.
 * Every response is parsed with its @cue/core schema; anything else is a CueApiError.
 */

export type CueApiErrorCode = 'network' | 'timeout' | 'aborted' | 'bad_response' | (string & {});

export class CueApiError extends Error {
  override readonly name = 'CueApiError';
  constructor(
    readonly code: CueApiErrorCode,
    /** HTTP status; 0 when no answer arrived. */
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }

  /** Worth retrying later: no answer, a timeout, a 429 or a 5xx. */
  get retryable(): boolean {
    return this.code === 'network' || this.code === 'timeout' || this.status === 429 || this.status >= 500;
  }
}

export interface CueApiOptions {
  /** e.g. `http://localhost:8787` (no trailing slash needed). */
  baseUrl: string;
  /** Sent as `x-cue-token` (and `?token=` on the stream URL) when the server requires it. */
  token?: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 10 s. */
  timeoutMs?: number;
}

export interface TraceQuery {
  task?: TaskId;
  callId?: string;
  ok?: boolean;
  before?: string;
  limit?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

type In<T extends z.ZodType> = z.input<T>;

export interface CueApi {
  readonly baseUrl: string;
  /** The SSE URL for a call, resuming after `afterSeq` when given. */
  streamUrl(callId: string, afterSeq?: number): string;
  exportUrl(): string;
  health(o?: RequestOptions): Promise<HealthResponse>;
  createCall(req: In<typeof CreateCallRequest>, o?: RequestOptions): Promise<CallView>;
  /** History, newest first. A number is just a limit; an object filters by rep, outcome, text, date. */
  listCalls(q?: number | CallListQuery, o?: RequestOptions): Promise<CallSummary[]>;
  /** Each rep's numbers and weekly trend, plus team totals. */
  team(q?: TeamQuery, o?: RequestOptions): Promise<TeamResponse>;
  contacts(q?: ContactListQuery, o?: RequestOptions): Promise<ContactListResponse>;
  contact(id: string, o?: RequestOptions): Promise<Contact>;
  createContact(c: ContactInput, o?: RequestOptions): Promise<Contact>;
  updateContact(id: string, c: ContactInput, o?: RequestOptions): Promise<Contact>;
  deleteContact(id: string, o?: RequestOptions): Promise<void>;
  /** Starts researching a contact before the call (fire and forget; cached on the server). */
  warmResearch(req: ResearchWarmRequest, o?: RequestOptions): Promise<ResearchWarmResponse>;
  /** CSV with a header row (name, title, company, phone, email, …). */
  importContacts(csv: string, ownerRepId?: string, o?: RequestOptions): Promise<ContactImportResponse>;
  getCall(callId: string, o?: RequestOptions): Promise<CallView>;
  addTurn(callId: string, turn: In<typeof AddTurnRequest>, o?: RequestOptions): Promise<AddTurnResponse>;
  suggestionAction(callId: string, suggestionId: string, req: SuggestionActionRequest, o?: RequestOptions): Promise<void>;
  endCall(callId: string, req?: EndCallRequest, o?: RequestOptions): Promise<CallView>;
  feedback(callId: string, req: In<typeof FeedbackRequest>, o?: RequestOptions): Promise<CallView>;
  practiceNext(callId: string, o?: RequestOptions): Promise<PracticeNextResponse>;
  getRecord(callId: string, o?: RequestOptions): Promise<CallRecord>;
  playbook(o?: RequestOptions): Promise<PlaybookResponse>;
  approveLine(lineId: string, o?: RequestOptions): Promise<PlaybookLine>;
  rejectLine(lineId: string, o?: RequestOptions): Promise<PlaybookLine>;
  stats(o?: RequestOptions): Promise<StatsResponse>;
  /** Mubit traces, newest first, without bodies. `nextCursor` pages back. */
  traces(q?: TraceQuery, o?: RequestOptions): Promise<TraceListResponse>;
  /** One trace with its full input and output. */
  trace(id: string, o?: RequestOptions): Promise<TraceDetail>;
  insights(range?: TraceRange, o?: RequestOptions): Promise<InsightsResponse>;
  /** Download URL for a trace export (jsonl, OpenAI fine-tune, or Langfuse batch). */
  traceExportUrl(q?: { format?: TraceExportFormat; task?: TaskId; range?: TraceRange }): string;
  trellusStatus(o?: RequestOptions): Promise<TrellusStatusResponse>;
  trellusSync(o?: RequestOptions): Promise<TrellusSyncResponse>;
  setTrellusKey(req: TrellusKeyRequest, o?: RequestOptions): Promise<TrellusStatusResponse>;
  trellusDispositions(o?: RequestOptions): Promise<TrellusDispositionsResponse>;
  setTrellusDispositions(req: TrellusDispositionsRequest, o?: RequestOptions): Promise<TrellusDispositionsResponse>;
  /** A short-lived Deepgram token for browser streaming. CueApiError `stt_not_configured` (404) when the server has no key. */
  sttToken(o?: RequestOptions): Promise<SttTokenResponse>;
}

const enc = encodeURIComponent;

/** `?a=1&b=x` from the defined entries, or ''. */
function qs(params: Record<string, string | number | undefined>): string {
  const p = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '');
  return p.length ? `?${p.map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&')}` : '';
}

export function createCueApi(opts: CueApiOptions): CueApi {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

  async function request<T extends z.ZodType | null>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, schema: T, body?: unknown, o?: RequestOptions): Promise<T extends z.ZodType ? z.infer<T> : void> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = o?.signal ? anySignal([o.signal, timeout.signal]) : timeout.signal;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers['x-cue-token'] = opts.token;
    let res: Response;
    try {
      res = await doFetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
    } catch (e) {
      clearTimeout(timer);
      if (o?.signal?.aborted) throw new CueApiError('aborted', 0, 'Request cancelled');
      if (timeout.signal.aborted) throw new CueApiError('timeout', 0, `No answer from the server in ${timeoutMs} ms`);
      throw new CueApiError('network', 0, e instanceof Error ? e.message : 'Network error');
    }
    try {
      const requestId = res.headers.get('x-request-id');
      if (!res.ok) {
        const raw = await res.json().catch(() => null);
        const err = ApiError.safeParse(raw);
        if (err.success) throw new CueApiError(err.data.error.code, res.status, err.data.error.message, err.data.error.details, requestId);
        throw new CueApiError(`http_${res.status}`, res.status, `Server answered ${res.status}`, undefined, requestId);
      }
      if (schema === null || res.status === 204) return undefined as never;
      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        throw new CueApiError('bad_response', res.status, 'Response was not JSON', undefined, requestId);
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new CueApiError('bad_response', res.status, `Response did not match the contract for ${method} ${path}`, parsed.error.issues.slice(0, 5), requestId);
      return parsed.data as never;
    } catch (e) {
      if (e instanceof CueApiError) throw e;
      if (timeout.signal.aborted) throw new CueApiError('timeout', 0, `No answer from the server in ${timeoutMs} ms`);
      if (o?.signal?.aborted) throw new CueApiError('aborted', 0, 'Request cancelled');
      throw new CueApiError('network', 0, e instanceof Error ? e.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }
  }

  const call = (id: string) => `/api/calls/${enc(id)}`;

  return {
    baseUrl: base,
    streamUrl(callId, afterSeq) {
      const q = new URLSearchParams();
      if (afterSeq !== undefined) q.set('after', String(afterSeq));
      if (opts.token) q.set('token', opts.token);
      const qs = q.toString();
      return `${base}${call(callId)}/stream${qs ? `?${qs}` : ''}`;
    },
    exportUrl: () => `${base}/api/export.jsonl`,
    health: (o) => request('GET', '/health', HealthResponse, undefined, o),
    createCall: (req, o) => request('POST', '/api/calls', CallView, req, o),
    listCalls: (q, o) => request('GET', `/api/calls${qs(typeof q === 'number' ? { limit: q } : (q ?? {}))}`, CallSummary.array(), undefined, o),
    team: (q, o) => request('GET', `/api/team${qs(q ?? {})}`, TeamResponse, undefined, o),
    contacts: (q, o) => request('GET', `/api/contacts${qs(q ?? {})}`, ContactListResponse, undefined, o),
    contact: (id, o) => request('GET', `/api/contacts/${enc(id)}`, Contact, undefined, o),
    createContact: (c, o) => request('POST', '/api/contacts', Contact, c, o),
    updateContact: (id, c, o) => request('PUT', `/api/contacts/${enc(id)}`, Contact, c, o),
    deleteContact: (id, o) => request('DELETE', `/api/contacts/${enc(id)}`, null, undefined, o),
    warmResearch: (req, o) => request('POST', '/api/research/warm', ResearchWarmResponse, req, o),
    importContacts: (csv, ownerRepId, o) => request('POST', '/api/contacts/import', ContactImportResponse, { csv, ...(ownerRepId ? { ownerRepId } : {}) }, o),
    getCall: (id, o) => request('GET', call(id), CallView, undefined, o),
    addTurn: (id, turn, o) => request('POST', `${call(id)}/turns`, AddTurnResponse, turn, o),
    suggestionAction: (id, sid, req, o) => request('POST', `${call(id)}/suggestions/${enc(sid)}/action`, null, req, o),
    endCall: (id, req, o) => request('POST', `${call(id)}/end`, CallView, req ?? {}, o),
    feedback: (id, req, o) => request('POST', `${call(id)}/feedback`, CallView, req, o),
    practiceNext: (id, o) => request('POST', `${call(id)}/practice/next`, PracticeNextResponse, {}, o),
    getRecord: (id, o) => request('GET', `${call(id)}/record`, CallRecord, undefined, o),
    playbook: (o) => request('GET', '/api/playbook', PlaybookResponse, undefined, o),
    approveLine: (id, o) => request('POST', `/api/playbook/lines/${enc(id)}/approve`, PlaybookLine, {}, o),
    rejectLine: (id, o) => request('POST', `/api/playbook/lines/${enc(id)}/reject`, PlaybookLine, {}, o),
    stats: (o) => request('GET', '/api/stats', StatsResponse, undefined, o),
    traces: (q, o) => request('GET', `/api/traces${qs({ ...q, ok: q?.ok === undefined ? undefined : String(q.ok) })}`, TraceListResponse, undefined, o),
    trace: (id, o) => request('GET', `/api/traces/${enc(id)}`, TraceDetail, undefined, o),
    insights: (range, o) => request('GET', `/api/insights${qs({ range })}`, InsightsResponse, undefined, o),
    traceExportUrl: (q) => `${base}/api/traces/export${qs(q ?? {})}`,
    trellusStatus: (o) => request('GET', '/api/trellus/status', TrellusStatusResponse, undefined, o),
    trellusSync: (o) => request('POST', '/api/trellus/sync', TrellusSyncResponse, {}, o),
    setTrellusKey: (req, o) => request('POST', '/api/trellus/key', TrellusStatusResponse, req, o),
    trellusDispositions: (o) => request('GET', '/api/trellus/dispositions', TrellusDispositionsResponse, undefined, o),
    setTrellusDispositions: (req, o) => request('PUT', '/api/trellus/dispositions', TrellusDispositionsResponse, req, o),
    sttToken: (o) => request('POST', '/api/stt/token', SttTokenResponse, {}, o),
  };
}

/** AbortSignal.any where available; a small polyfill otherwise (older Safari). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      c.abort();
      break;
    }
    s.addEventListener('abort', () => c.abort(), { once: true });
  }
  return c.signal;
}
