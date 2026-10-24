import type { SttTokenResponse } from '@cue/core';
import { AppError } from './services/cue';


/**
 * Mints a short-lived Deepgram token (`POST /v1/auth/grant`) so the browser can stream audio to
 * Deepgram directly without ever holding the API key. 404 `stt_not_configured` without a key.
 */
export async function sttToken(opts: { apiKey: string; ttlSeconds: number; fetch: typeof fetch; now: () => number; host?: string }): Promise<SttTokenResponse> {
  const host = opts.host || 'api.deepgram.com';
  if (!opts.apiKey) throw new AppError(404, 'stt_not_configured', 'Speech-to-text is not configured on the server (DEEPGRAM_API_KEY)');
  let res: Response;
  try {
    res = await opts.fetch(`https://${host}/v1/auth/grant`, {
      method: 'POST',
      headers: { authorization: `Token ${opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: opts.ttlSeconds }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError(503, 'stt_unavailable', 'Could not reach Deepgram');
  }
  if (!res.ok) throw new AppError(503, 'stt_unavailable', `Deepgram refused the token request (${res.status})`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new AppError(503, 'stt_unavailable', 'Deepgram answered without a token');
  const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : opts.ttlSeconds;
  return { provider: 'deepgram', token: body.access_token, expiresAt: opts.now() + Math.round(ttl * 1000), host };
}
