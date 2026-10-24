import type { Transcriber, TranscriberEvents, TranscriberTurn } from '@cue/client';
import { newId, type Speaker } from '@cue/core';

/**
 * Streaming speech-to-text for the call tab's audio (Web Speech can only hear the default mic).
 * A provider turns a MediaStream into turns through the same `Transcriber` events @cue/client
 * uses, so the offscreen document treats every source alike.
 */
export interface SttCredentials {
  provider: 'deepgram';
  /** Short-lived token issued by the Cue server; the provider key itself never reaches the browser. */
  token: string;
  expiresAt?: number;
}

export type StreamingSttFactory = (stream: MediaStream, opts: { speaker: Speaker; callStartedAt: number; credentials: SttCredentials }) => Transcriber;

type Handler = (p: unknown) => void;

export class Emitter {
  private map = new Map<string, Set<Handler>>();
  on<E extends keyof TranscriberEvents>(ev: E, cb: (p: TranscriberEvents[E]) => void): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(cb as Handler);
    return () => set.delete(cb as Handler);
  }
  emit<E extends keyof TranscriberEvents>(ev: E, p: TranscriberEvents[E]): void {
    for (const cb of [...(this.map.get(ev) ?? [])]) {
      try {
        cb(p);
      } catch {
        /* a listener never stops transcription */
      }
    }
  }
}

/** Deepgram live results, the fields used here. */
export interface DeepgramResult {
  type: 'Results' | 'UtteranceEnd' | 'SpeechStarted' | 'Metadata' | string;
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: { transcript?: string }[] };
}

/**
 * Folds Deepgram's result stream into utterances: finals accumulate until `speech_final` or
 * `UtteranceEnd`; interims show the words so far. Pure, so it is unit tested on recorded results.
 */
export class UtteranceAssembler {
  private finals: string[] = [];
  private id: string | null = null;
  private startSec: number | null = null;
  private endSec = 0;

  constructor(
    private speaker: Speaker,
    private offsetMs: number,
    private makeId: () => string = () => newId('turn'),
  ) {}

  push(r: DeepgramResult): TranscriberTurn | null {
    if (r.type === 'UtteranceEnd') return this.close();
    if (r.type !== 'Results') return null;
    const text = (r.channel?.alternatives?.[0]?.transcript ?? '').trim();
    if (text) {
      this.id ??= this.makeId();
      if (this.startSec === null) this.startSec = r.start ?? 0;
      this.endSec = (r.start ?? 0) + (r.duration ?? 0);
    }
    if (r.is_final && text) this.finals.push(text);
    if (r.is_final && r.speech_final) return this.close();
    if (!this.id) return null;
    const words = [...this.finals, ...(r.is_final ? [] : [text])].filter(Boolean).join(' ');
    return words ? this.turn(words, false) : null;
  }

  private close(): TranscriberTurn | null {
    const words = this.finals.join(' ').trim();
    const t = words && this.id ? this.turn(words, true) : null;
    this.finals = [];
    this.id = null;
    this.startSec = null;
    return t;
  }

  private turn(text: string, final: boolean): TranscriberTurn {
    const startMs = Math.round((this.startSec ?? 0) * 1000);
    return {
      id: this.id!,
      speaker: this.speaker,
      text: text.slice(0, 4000),
      final,
      tMs: Math.max(0, this.offsetMs + startMs),
      durMs: Math.max(0, Math.round((this.endSec - (this.startSec ?? 0)) * 1000)),
      via: 'deepgram',
    };
  }
}

export const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true';

/** Streams the tab audio to Deepgram over a WebSocket (MediaRecorder → webm/opus chunks). */
export class DeepgramTranscriber implements Transcriber {
  private ev = new Emitter();
  private ws: WebSocket | null = null;
  private rec: MediaRecorder | null = null;
  private wanted = false;
  private attempts = 0;

  constructor(
    private stream: MediaStream,
    private opts: { speaker: Speaker; callStartedAt: number; credentials: SttCredentials },
  ) {}

  on<E extends keyof TranscriberEvents>(ev: E, cb: (p: TranscriberEvents[E]) => void): () => void {
    return this.ev.on(ev, cb);
  }

  async start(): Promise<void> {
    this.wanted = true;
    this.ev.emit('state', 'starting');
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    try {
      this.rec?.stop();
    } catch {
      /* not recording */
    }
    try {
      this.ws?.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws?.close();
    } catch {
      /* closed */
    }
    this.ws = null;
    this.rec = null;
    this.ev.emit('state', 'stopped');
  }

  private connect(): void {
    // Time since the call started, so turn offsets line up with the server's clock.
    const asm = new UtteranceAssembler(this.opts.speaker, Date.now() - this.opts.callStartedAt);
    const ws = new WebSocket(DEEPGRAM_URL, ['bearer', this.opts.credentials.token]);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.ev.emit('state', 'listening');
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(new MediaStream(this.stream.getAudioTracks()), { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      rec.start(250);
      this.rec = rec;
    };
    ws.onmessage = (m) => {
      let r: DeepgramResult;
      try {
        r = JSON.parse(String(m.data)) as DeepgramResult;
      } catch {
        return;
      }
      const t = asm.push(r);
      if (t) this.ev.emit('turn', t);
    };
    ws.onerror = () => this.ev.emit('error', { code: 'stt_socket', message: 'Lost the connection to the transcription service', fatal: false });
    ws.onclose = (e) => {
      try {
        this.rec?.stop();
      } catch {
        /* ignore */
      }
      this.rec = null;
      if (!this.wanted) return;
      // 1008 / 4001-ish: the token was refused or expired; don't hammer.
      if (e.code === 1008 || (e.code >= 4000 && e.code < 4100) || this.attempts >= 5) {
        this.wanted = false;
        this.ev.emit('error', { code: 'stt_auth', message: 'Tab transcription stopped: the server-issued token was refused or expired.', fatal: true });
        this.ev.emit('state', 'error');
        return;
      }
      this.attempts++;
      setTimeout(() => this.wanted && this.connect(), Math.min(8000, 500 * 2 ** this.attempts));
    };
  }
}

export const createStreamingStt: StreamingSttFactory = (stream, opts) => new DeepgramTranscriber(stream, opts);
