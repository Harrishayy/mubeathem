import { WebSpeechTranscriber, type Transcriber, type TranscriberTurn } from '@cue/client';
import type { Speaker } from '@cue/core';
import type { CaptureStatus, Levels, OffscreenCommand, OffscreenEvent } from '../messages';
import { LevelMeter } from './levels';
import { createStreamingStt, type StreamingSttFactory } from './stt';

type StartCommand = Extract<OffscreenCommand, { type: 'capture.start' }>;

/** Interims are throttled per utterance (250 ms, so the server can start a cue before the final lands); finals always go straight out. */
export function interimGate(minGapMs = 250, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (t: TranscriberTurn): boolean => {
    if (t.final) {
      last.delete(t.id);
      return true;
    }
    const prev = last.get(t.id);
    const n = now();
    if (prev !== undefined && n - prev < minGapMs) return false;
    last.set(t.id, n);
    return true;
  };
}

function micError(e: unknown): CaptureStatus {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return { state: 'denied', message: 'Microphone blocked. Use "Allow microphone" in the Cue side panel, then retry.' };
  if (name === 'NotFoundError') return { state: 'unavailable', message: 'No microphone found.' };
  return { state: 'error', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Runs in the offscreen document: the call tab's audio (the prospect) through a streaming STT
 * provider, the mic (the rep) through Web Speech, and both voice levels for Sprout.
 */
export class CaptureController {
  private ctx: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private meters: { prospect?: LevelMeter; rep?: LevelMeter } = {};
  private transcribers: Transcriber[] = [];
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private micSpeaker: Speaker = 'rep';
  private gate = interimGate();

  constructor(
    private emit: (e: OffscreenEvent) => void,
    private stt: StreamingSttFactory = createStreamingStt,
  ) {}

  setMicSpeaker(s: Speaker): void {
    this.micSpeaker = s;
  }

  async start(cmd: StartCommand): Promise<void> {
    this.stop();
    this.micSpeaker = cmd.micSpeaker;
    this.ctx = new AudioContext();
    await Promise.all([this.startTab(cmd), cmd.mic ? this.startMic(cmd) : Promise.resolve()]);
    this.levelTimer = setInterval(() => {
      const levels: Levels = { prospect: this.meters.prospect?.read() ?? 0, rep: this.meters.rep?.read() ?? 0 };
      this.emit({ type: 'capture.levels', levels });
    }, 100);
  }

  stop(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    for (const t of this.transcribers) t.stop();
    this.transcribers = [];
    this.meters.prospect?.disconnect();
    this.meters.rep?.disconnect();
    this.meters = {};
    for (const s of this.streams) for (const track of s.getTracks()) track.stop();
    this.streams = [];
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private status(side: 'tab' | 'mic', status: CaptureStatus) {
    this.emit({ type: 'capture.status', side, status });
  }

  private sendTurn = (turn: TranscriberTurn) => {
    if (this.gate(turn)) this.emit({ type: 'capture.turn', turn });
  };

  private async startTab(cmd: StartCommand): Promise<void> {
    if (!cmd.tabStreamId) return; // the background already reported why
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: cmd.tabStreamId } } as unknown as MediaTrackConstraints,
        video: false,
      });
    } catch (e) {
      this.status('tab', { state: 'error', message: `Couldn't open the tab's audio: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    this.streams.push(stream);
    const meter = new LevelMeter(this.ctx!, stream);
    meter.playThrough(this.ctx!);
    this.meters.prospect = meter;
    if (!cmd.stt) {
      this.status('tab', { state: 'unavailable', message: "Hearing the call tab, but tab transcription isn't set up on the server. Type the prospect's lines, or flip the mic to Prospect." });
      return;
    }
    const t = this.stt(stream, { speaker: 'prospect', callStartedAt: cmd.callStartedAt, credentials: cmd.stt });
    t.on('turn', this.sendTurn);
    t.on('state', (s) => {
      if (s === 'listening') this.status('tab', { state: 'on' });
    });
    t.on('error', (e) => {
      if (e.fatal) this.status('tab', { state: 'error', message: e.message });
    });
    this.transcribers.push(t);
    await t.start();
  }

  private async startMic(cmd: StartCommand): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (e) {
      this.status('mic', micError(e));
      return;
    }
    this.streams.push(stream);
    this.meters.rep = new LevelMeter(this.ctx!, stream);
    if (!WebSpeechTranscriber.available()) {
      this.status('mic', { state: 'unavailable', message: 'Speech recognition is not available here. Type your lines instead.' });
      return;
    }
    const t = new WebSpeechTranscriber({ speaker: () => this.micSpeaker, callStartedAt: cmd.callStartedAt });
    t.on('turn', this.sendTurn);
    t.on('state', (s) => {
      if (s === 'listening') this.status('mic', { state: 'on' });
    });
    t.on('error', (e) => {
      if (e.fatal) this.status('mic', e.code === 'not-allowed' ? micError({ name: 'NotAllowedError' }) : { state: 'error', message: e.message });
    });
    this.transcribers.push(t);
    await t.start();
  }
}
