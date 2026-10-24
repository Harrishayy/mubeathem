/** RMS of a time-domain buffer (bytes centred on 128), scaled so speech sits around 0.3–0.8. */
export function rmsLevel(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (const v of buf) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length);
  return Math.min(1, rms * 4);
}

/** Exponential smoothing with a faster attack than release, so Sprout's ring reacts but doesn't flicker. */
export function smooth(prev: number, next: number, attack = 0.6, release = 0.15): number {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

/** Voice level of a MediaStream, read through an AnalyserNode. */
export class LevelMeter {
  private analyser: AnalyserNode;
  private buf: Uint8Array<ArrayBuffer>;
  private source: MediaStreamAudioSourceNode;
  private value = 0;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.source.connect(this.analyser);
  }

  /** Lets the rep keep hearing the tab: capturing a tab mutes it unless the audio is played back. */
  playThrough(ctx: AudioContext): void {
    this.source.connect(ctx.destination);
  }

  read(): number {
    this.analyser.getByteTimeDomainData(this.buf);
    this.value = smooth(this.value, rmsLevel(this.buf));
    return this.value;
  }

  disconnect(): void {
    try {
      this.source.disconnect();
      this.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
