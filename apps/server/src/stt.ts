import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { SttTokenResponse } from '@cue/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { AppError } from './services/cue';


/**
 * Mints a short-lived Deepgram token (`POST /v1/auth/grant`) so the browser can stream audio to
 * Deepgram directly without ever holding the API key. 404 `stt_not_configured` without a key.
 */
export async function sttToken(opts: {
  apiKey: string;
  ttlSeconds: number;
  fetch: typeof fetch;
  now: () => number;
  host?: string;
  /** The relay on this server, and the host the browser reaches it on. Used when the key may not mint tokens. */
  relay?: { relay: SttRelay; publicHost: string; force?: boolean };
}): Promise<SttTokenResponse> {
  const host = opts.host || 'api.deepgram.com';
  if (!opts.apiKey) throw new AppError(404, 'stt_not_configured', 'Speech-to-text is not configured on the server (DEEPGRAM_API_KEY)');
  const r = opts.relay;
  if (r && (r.force || r.relay.grantRefused)) return r.relay.mint(r.publicHost, opts.ttlSeconds);
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
  // A key without the Member role can transcribe but not mint tokens: relay the audio instead.
  if (res.status === 403 && r) {
    r.relay.grantRefused = true;
    return r.relay.mint(r.publicHost, opts.ttlSeconds);
  }
  if (!res.ok) throw new AppError(503, 'stt_unavailable', `Deepgram refused the token request (${res.status})`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new AppError(503, 'stt_unavailable', 'Deepgram answered without a token');
  const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : opts.ttlSeconds;
  return { provider: 'deepgram', token: body.access_token, expiresAt: opts.now() + Math.round(ttl * 1000), host };
}

/**
 * Relays the browser's audio to Deepgram through this server, for a key that may not mint tokens.
 * The browser connects to `wss://{this server}/v1/listen?…` with the subprotocols `['bearer', token]`,
 * exactly as it would to Deepgram, so the client needs no change; the key never leaves the server.
 * Tokens are random, short-lived and only open a connection (an open stream outlives them, as with Deepgram's).
 */
export class SttRelay {
  grantRefused = false;
  private tokens = new Map<string, number>();
  private wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has('bearer') ? 'bearer' : false) });

  constructor(private opts: { apiKey: () => string; host: () => string; now: () => number; log?: (msg: string) => void }) {}

  mint(publicHost: string, ttlSeconds: number): SttTokenResponse {
    const now = this.opts.now();
    for (const [t, exp] of this.tokens) if (exp <= now) this.tokens.delete(t);
    const token = `cue_${randomBytes(24).toString('hex')}`;
    const expiresAt = now + ttlSeconds * 1000;
    this.tokens.set(token, expiresAt);
    return { provider: 'deepgram', token, expiresAt, host: publicHost };
  }

  /** Takes over `/v1/listen` upgrades on the HTTP server. */
  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://relay');
      if (url.pathname !== '/v1/listen') return void socket.destroy();
      const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
      const token = protocols[0] === 'bearer' ? protocols[1] : undefined;
      const exp = token ? this.tokens.get(token) : undefined;
      if (!token || exp === undefined || exp <= this.opts.now() || !this.opts.apiKey()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return void socket.destroy();
      }
      this.wss.handleUpgrade(req, socket, head, (client) => this.pipe(client, url.search));
    });
  }

  private pipe(client: WebSocket, query: string): void {
    const host = this.opts.host();
    const upstream = new WebSocket(`${host.includes('://') ? host : `wss://${host}`}/v1/listen${query}`, { headers: { authorization: `Token ${this.opts.apiKey()}` } });
    const pending: { data: RawData; binary: boolean }[] = [];
    client.on('message', (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else if (upstream.readyState === WebSocket.CONNECTING && pending.length < 200) pending.push({ data, binary });
    });
    upstream.on('open', () => {
      for (const m of pending.splice(0)) upstream.send(m.data, { binary: m.binary });
    });
    upstream.on('message', (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    // Close codes 1005/1006 can't be sent; anything else is passed through so the client sees why.
    const code = (c: number) => (c >= 3000 || (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) ? c : 1011);
    upstream.on('close', (c, reason) => client.readyState <= WebSocket.OPEN && client.close(code(c), reason));
    client.on('close', () => upstream.readyState <= WebSocket.OPEN && upstream.close());
    upstream.on('error', (e) => {
      this.opts.log?.(`stt relay upstream: ${e.message}`);
      if (client.readyState <= WebSocket.OPEN) client.close(1011, 'speech-to-text upstream failed');
    });
    client.on('error', () => upstream.terminate());
  }
}
