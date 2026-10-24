/**
 * Every failure out of the client is a MubitError, so the pipeline can emit `pipeline.error` and fall
 * back to rules without guessing. `code` is Mubit's own error code when the gateway sent one
 * (e.g. `starter_credit_busy`), otherwise one of ours below.
 */
export type MubitErrorCode =
  | 'not_configured'
  | 'bad_input'
  | 'bad_output'
  | 'refused'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'http'
  | (string & {});

export class MubitError extends Error {
  override readonly name = 'MubitError';
  readonly code: MubitErrorCode;
  /** HTTP status, or null when no answer arrived. */
  readonly status: number | null;
  readonly retryable: boolean;
  readonly requestId: string | null;
  /** Seconds the gateway asked us to wait (`retry-after`), when it said. */
  readonly retryAfterS: number | null;

  constructor(init: { code: MubitErrorCode; message: string; status?: number | null; retryable?: boolean; requestId?: string | null; retryAfterS?: number | null; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.status = init.status ?? null;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId ?? null;
    this.retryAfterS = init.retryAfterS ?? null;
  }
}

export function isMubitError(e: unknown): e is MubitError {
  return e instanceof MubitError;
}
