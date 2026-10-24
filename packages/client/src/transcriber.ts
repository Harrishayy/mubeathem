import { newId, type Speaker } from '@cue/core';

/** One transcript turn as a transcriber produces it; ready for `api.addTurn` / `TurnBuffer.push`. */
export interface TranscriberTurn {
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  tMs: number;
  durMs?: number;
  via: string;
}

/** `unavailable`: gave up after repeated failures (offline, permission withdrawn); `error`: a fatal error on first sight. */
export type TranscriberState = 'idle' | 'starting' | 'listening' | 'stopped' | 'error' | 'unavailable';

export interface TranscriberEvents {
  turn: TranscriberTurn;
  /** 0..1. Web Speech exposes no audio level, so it reports 1 on sound start and 0 on sound end. */
  level: number;
  error: { code: string; message: string; fatal: boolean };
  state: TranscriberState;
}

export interface Transcriber {
  start(): Promise<void>;
  stop(): void;
  on<E extends keyof TranscriberEvents>(ev: E, cb: (payload: TranscriberEvents[E]) => void): () => void;
}

class Emitter {
  private map = new Map<string, Set<(p: unknown) => void>>();
  on<E extends keyof TranscriberEvents>(ev: E, cb: (p: TranscriberEvents[E]) => void): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(cb as (p: unknown) => void);
    return () => set.delete(cb as (p: unknown) => void);
  }
  emit<E extends keyof TranscriberEvents>(ev: E, p: TranscriberEvents[E]): void {
    for (const cb of [...(this.map.get(ev) ?? [])]) {
      try {
        cb(p);
      } catch {
        /* a listener error never stops transcription */
      }
    }
  }
}

/* ───────── Web Speech ───────── */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [i: number]: SpeechAlternative;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
/** The parts of SpeechRecognition used here (Chrome ships it as webkitSpeechRecognition). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface WebSpeechOptions {
  /** Who is speaking into this recogniser. A function lets the caller switch (push-to-talk, tab vs mic). */
  speaker: Speaker | (() => Speaker);
  lang?: string;
  /** Injectable for tests; defaults to `SpeechRecognition ?? webkitSpeechRecognition`. */
  recognition?: SpeechRecognitionCtor;
  /** Epoch ms the call started, for `tMs`. Defaults to when `start()` was first called. */
  callStartedAt?: number;
  now?: () => number;
  /** Consecutive retryable failures before giving up with state `unavailable`. Default 5. */
  maxFailures?: number;
  /** Backoff for retryable failures: 1 s doubling to 30 s by default. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
}

/** Fatal on first sight: retrying can't fix them. */
const FATAL = new Set(['audio-capture', 'language-not-supported']);
/** May clear up (connection back, permission re-granted): retried with backoff, then given up on. */
const RETRY = new Set(['network', 'not-allowed', 'service-not-allowed']);
/** A session shorter than this that ends on its own is restarted after a pause, never in a tight loop. */
const MIN_SESSION_MS = 1000;

/** Browser speech-to-text: interim and final turns, auto-restarts when the engine stops on silence. */
export class WebSpeechTranscriber implements Transcriber {
  private ev = new Emitter();
  private rec: SpeechRecognitionLike | null = null;
  private wanted = false;
  private startedAt: number | null;
  private utterance: { id: string; startedAt: number } | null = null;
  private now: () => number;
  private failures = 0;
  private retryPending = false;
  private sessionStartedAt = 0;
  private timer: unknown = null;

  constructor(private opts: WebSpeechOptions) {
    this.startedAt = opts.callStartedAt ?? null;
    this.now = opts.now ?? Date.now;
  }

  static available(): boolean {
    const g = globalThis as unknown as Record<string, unknown>;
    return !!(g.SpeechRecognition ?? g.webkitSpeechRecognition);
  }

  on<E extends keyof TranscriberEvents>(ev: E, cb: (p: TranscriberEvents[E]) => void): () => void {
    return this.ev.on(ev, cb);
  }

  async start(): Promise<void> {
    const g = globalThis as unknown as Record<string, SpeechRecognitionCtor | undefined>;
    const Ctor = this.opts.recognition ?? g.SpeechRecognition ?? g.webkitSpeechRecognition;
    if (!Ctor) {
      this.ev.emit('error', { code: 'unsupported', message: 'Speech recognition is not available in this browser', fatal: true });
      this.ev.emit('state', 'error');
      return;
    }
    if (this.wanted) return;
    this.wanted = true;
    this.failures = 0;
    this.retryPending = false;
    this.startedAt ??= this.now();
    this.ev.emit('state', 'starting');
    const rec = new Ctor();
    rec.lang = this.opts.lang ?? 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => this.ev.emit('state', 'listening');
    rec.onsoundstart = () => {
      this.failures = 0;
      this.ev.emit('level', 1);
    };
    rec.onsoundend = () => this.ev.emit('level', 0);
    rec.onresult = (e) => {
      this.failures = 0;
      this.onResult(e);
    };
    rec.onerror = (e) => this.onError(e);
    rec.onend = () => this.onEnd();
    this.rec = rec;
    this.launch();
  }

  stop(): void {
    this.wanted = false;
    this.clearTimer();
    this.rec?.stop();
    this.utterance = null;
  }

  private launch(): void {
    if (!this.wanted || !this.rec) return;
    this.sessionStartedAt = this.now();
    try {
      this.rec.start();
    } catch {
      /* already started */
    }
  }

  private onError(e: { error: string; message?: string }): void {
    const message = e.message || e.error;
    if (FATAL.has(e.error)) {
      this.wanted = false;
      this.clearTimer();
      this.ev.emit('error', { code: e.error, message, fatal: true });
      this.ev.emit('state', 'error');
      return;
    }
    if (!RETRY.has(e.error)) return void this.ev.emit('error', { code: e.error, message, fatal: false }); // no-speech, aborted: onend restarts
    this.failures++;
    if (this.failures >= (this.opts.maxFailures ?? 5)) {
      this.wanted = false;
      this.retryPending = false;
      this.clearTimer();
      this.ev.emit('error', { code: e.error, message: `${message} (gave up after ${this.failures} attempts)`, fatal: true });
      this.ev.emit('state', 'unavailable');
      try {
        this.rec?.abort();
      } catch {
        /* ignore */
      }
      return;
    }
    this.retryPending = true;
    this.ev.emit('error', { code: e.error, message, fatal: false });
  }

  private onEnd(): void {
    if (!this.wanted) {
      if (this.failures < (this.opts.maxFailures ?? 5)) this.ev.emit('state', 'stopped');
      return;
    }
    let delay = 0;
    if (this.retryPending) {
      delay = Math.min(this.opts.maxBackoffMs ?? 30_000, (this.opts.minBackoffMs ?? 1000) * 2 ** (this.failures - 1));
      this.retryPending = false;
      this.ev.emit('state', 'starting');
    } else if (this.now() - this.sessionStartedAt < MIN_SESSION_MS) delay = MIN_SESSION_MS;
    if (delay === 0) return this.launch();
    this.clearTimer();
    const setT = this.opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = setT(() => {
      this.timer = null;
      this.launch();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    (this.opts.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private speaker(): Speaker {
    return typeof this.opts.speaker === 'function' ? this.opts.speaker() : this.opts.speaker;
  }

  private onResult(e: SpeechResultEvent): void {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      const text = (r[0]?.transcript ?? '').trim();
      if (!text) continue;
      const now = this.now();
      this.utterance ??= { id: newId('turn'), startedAt: now };
      const u = this.utterance;
      this.ev.emit('turn', { id: u.id, speaker: this.speaker(), text, final: r.isFinal, tMs: Math.max(0, u.startedAt - (this.startedAt ?? now)), durMs: Math.max(0, now - u.startedAt), via: 'webspeech' });
      if (r.isFinal) this.utterance = null;
    }
  }
}

/* ───────── typed ───────── */

/** Typed turns (practice mode, and the fallback when capture is denied). */
export class TypedTranscriber implements Transcriber {
  private ev = new Emitter();
  private startedAt: number | null;
  private running = false;
  private now: () => number;

  constructor(opts: { speaker?: Speaker; callStartedAt?: number; now?: () => number } = {}) {
    this.defaultSpeaker = opts.speaker ?? 'rep';
    this.startedAt = opts.callStartedAt ?? null;
    this.now = opts.now ?? Date.now;
  }
  private defaultSpeaker: Speaker;

  on<E extends keyof TranscriberEvents>(ev: E, cb: (p: TranscriberEvents[E]) => void): () => void {
    return this.ev.on(ev, cb);
  }

  async start(): Promise<void> {
    this.running = true;
    this.startedAt ??= this.now();
    this.ev.emit('state', 'listening');
  }

  stop(): void {
    this.running = false;
    this.ev.emit('state', 'stopped');
  }

  /** Emits one final turn. Returns it, or null when stopped or empty. */
  say(text: string, speaker: Speaker = this.defaultSpeaker): TranscriberTurn | null {
    const t = text.trim();
    if (!this.running || !t) return null;
    const now = this.now();
    const turn: TranscriberTurn = { id: newId('turn'), speaker, text: t.slice(0, 4000), final: true, tMs: Math.max(0, now - (this.startedAt ?? now)), via: 'typed' };
    this.ev.emit('turn', turn);
    return turn;
  }
}
