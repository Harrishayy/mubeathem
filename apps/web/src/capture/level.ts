import { createStore } from '../state/store';

/** Mic voice level 0..1 for Sprout's listening ring. */
export const levelStore = createStore(0);

/** RMS of a time-domain frame mapped to 0..1 with a soft knee (speech sits around 0.02..0.2 RMS). */
export function levelFromFrame(frame: Uint8Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = (frame[i]! - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / frame.length);
  return Math.max(0, Math.min(1, (rms - 0.01) * 6));
}

export interface LevelMeter {
  stop(): void;
}

/** Opens the mic and feeds `levelStore` from an AnalyserNode until stopped. */
export async function startLevelMeter(): Promise<LevelMeter> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const frame = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let smooth = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(frame);
    const l = levelFromFrame(frame);
    // Fast attack, slow release, so the ring breathes instead of flickering.
    smooth = l > smooth ? smooth + (l - smooth) * 0.6 : smooth + (l - smooth) * 0.12;
    levelStore.set(Math.round(smooth * 100) / 100);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return {
    stop() {
      cancelAnimationFrame(raf);
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
      levelStore.set(0);
    },
  };
}
