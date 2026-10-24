/** How the Mubit client is configured. Read from the server's environment, never from a client. */
export interface MubitConfig {
  apiKey: string;
  baseUrl: string;
  /** `fast` serves read_moment, check_claim, simulate_prospect; `write` serves the rest (architecture §4.1). */
  models: { fast: string; write: string };
  /** Max calls in flight at once; the starter credit caps calls in flight per project. */
  concurrency: number;
  /** Default deadline per `run`, covering queueing, retries and waits. */
  timeoutMs: number;
  /** `metadata` sends `x-middleware-record: metadata`, so Mubit keeps no request or answer text. */
  record: 'full' | 'metadata';
  /** False when no key is set: the server then runs on the rules engine. */
  configured: boolean;
}

export const DEFAULT_BASE_URL = 'https://api.mubit.ai/openai/v1';
export const DEFAULT_MODELS = { fast: 'gpt-4o-mini', write: 'gpt-4.1-mini' } as const;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadMubitConfig(env: Record<string, string | undefined> = process.env): MubitConfig {
  const apiKey = (env.MUBIT_API_KEY ?? '').trim();
  return {
    apiKey,
    baseUrl: (env.MUBIT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    models: {
      fast: env.CUE_MODEL_FAST?.trim() || DEFAULT_MODELS.fast,
      write: env.CUE_MODEL_WRITE?.trim() || DEFAULT_MODELS.write,
    },
    concurrency: positiveInt(env.CUE_MUBIT_CONCURRENCY, 4),
    timeoutMs: positiveInt(env.CUE_MUBIT_TIMEOUT_MS, 12_000),
    record: env.CUE_MUBIT_RECORD?.trim().toLowerCase() === 'metadata' ? 'metadata' : 'full',
    configured: apiKey.length > 0,
  };
}
