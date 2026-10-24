import type { CueApi } from '@cue/client';
import type { SttCredentials } from '../capture/stt';

/**
 * A short-lived tab-transcription token from the server (`POST /api/stt/token`). Null when the server
 * has no provider (404 `stt_not_configured`) or can't be reached: the offscreen document then says
 * tab transcription isn't set up, and typed or mic turns still work.
 */
export async function sttCredentials(api: Pick<CueApi, 'sttToken'>): Promise<SttCredentials | null> {
  try {
    const r = await api.sttToken();
    return { provider: r.provider, token: r.token, expiresAt: r.expiresAt };
  } catch {
    return null;
  }
}
