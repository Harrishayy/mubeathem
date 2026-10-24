/**
 * Errors keep the HTTP status, endpoint, UTC time and response text (the docs ask for exactly these
 * when contacting support) but never the key. 401 bodies carry distinct meanings, kept as classes.
 */
export type TrellusEndpoint = 'visible' | 'bootstrap' | 'sessionList' | 'metricDetails' | 'session' | 'audioLinks';

export type TrellusErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'not_permissioned'
  | 'not_on_db'
  | 'bad_request'
  | 'too_large'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'invalid_response'
  | 'invalid_request';

export class TrellusError extends Error {
  override readonly name: string = 'TrellusError';
  constructor(
    readonly code: TrellusErrorCode,
    readonly endpoint: TrellusEndpoint,
    readonly status: number | null,
    readonly body: string,
    /** ISO UTC time the response was received. */
    readonly at: string,
    message?: string,
  ) {
    super(message ?? `Trellus ${endpoint} ${status ?? 'network'}: ${body || code}`);
  }
  /** Worth retrying later (the poller keeps the call open). */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'server' || this.code === 'network';
  }
}

/** 401 "inactive user" / "not authorized" on the key itself: invalid key or inactive account. */
export class TrellusUnauthorizedError extends TrellusError {
  override readonly name = 'TrellusUnauthorizedError';
}
/** 401 "not found": the session could not be located (wrong id or header). Not a scope problem. */
export class TrellusNotFoundError extends TrellusError {
  override readonly name = 'TrellusNotFoundError';
}
/** 401 "not permissioned" / "not authorized": the key's user cannot read that session or team. */
export class TrellusNotPermissionedError extends TrellusError {
  override readonly name = 'TrellusNotPermissionedError';
}
/** 401 "not on db": the record exists but its stored detail could not be loaded. List columns may still work. */
export class TrellusNotOnDbError extends TrellusError {
  override readonly name = 'TrellusNotOnDbError';
}
export class TrellusRateLimitError extends TrellusError {
  override readonly name = 'TrellusRateLimitError';
  retryAfterMs = 0;
}
export class TrellusServerError extends TrellusError {
  override readonly name = 'TrellusServerError';
}
export class TrellusRequestError extends TrellusError {
  override readonly name = 'TrellusRequestError';
}
export class TrellusNetworkError extends TrellusError {
  override readonly name = 'TrellusNetworkError';
}

const MAX_BODY = 500;

/** Builds the right error class from a non-2xx response. `secret` is scrubbed from the body. */
export function errorFromResponse(endpoint: TrellusEndpoint, status: number, rawBody: string, at: string, secret?: string): TrellusError {
  const body = redact(rawBody, secret).slice(0, MAX_BODY);
  if (status === 401 || status === 403) {
    const t = body.toLowerCase();
    if (t.includes('not on db')) return new TrellusNotOnDbError('not_on_db', endpoint, status, body, at);
    if (t.includes('not found')) return new TrellusNotFoundError('not_found', endpoint, status, body, at);
    if (t.includes('not permissioned')) return new TrellusNotPermissionedError('not_permissioned', endpoint, status, body, at);
    // "not authorized" on a detail endpoint is about the session; on the directory it is the key.
    if (t.includes('not authorized') && (endpoint === 'session' || endpoint === 'audioLinks')) {
      return new TrellusNotPermissionedError('not_permissioned', endpoint, status, body, at);
    }
    return new TrellusUnauthorizedError('unauthorized', endpoint, status, body, at);
  }
  if (status === 429) return new TrellusRateLimitError('rate_limited', endpoint, status, body, at);
  if (status === 413) return new TrellusRequestError('too_large', endpoint, status, body, at);
  if (status >= 500) return new TrellusServerError('server', endpoint, status, body, at);
  return new TrellusRequestError('bad_request', endpoint, status, body, at);
}

export function redact(text: string, secret?: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('[redacted]');
}
