import { WebSpeechTranscriber, type Transcriber } from '@cue/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addTurn } from '../state/call';
import { startLevelMeter, type LevelMeter } from './level';
import { currentSpeaker, speakerStore } from './speaker';

export type CaptureState = 'off' | 'starting' | 'listening' | 'error' | 'unsupported';

export interface Capture {
  state: CaptureState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  supported: boolean;
}

const ERROR_COPY: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the address bar, or type turns instead.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. Type turns instead.',
  'audio-capture': 'No microphone found. Plug one in, or type turns instead.',
  unsupported: 'This browser has no speech recognition. Chrome or Edge do; typed turns always work.',
  network: 'Speech recognition lost its connection. It will retry on its own.',
};

/** Mic capture for a live call: Web Speech for words, an AnalyserNode for Sprout's voice level. */
export function useCapture(callStartedAt: number | null): Capture {
  const [state, setState] = useState<CaptureState>('off');
  const [error, setError] = useState<string | null>(null);
  const tx = useRef<Transcriber | null>(null);
  const meter = useRef<LevelMeter | null>(null);
  const offs = useRef<(() => void)[]>([]);
  const supported = WebSpeechTranscriber.available();

  const stop = useCallback(() => {
    tx.current?.stop();
    tx.current = null;
    meter.current?.stop();
    meter.current = null;
    for (const off of offs.current) off();
    offs.current = [];
    setState('off');
  }, []);

  const start = useCallback(async () => {
    if (tx.current) return;
    setError(null);
    if (!supported) {
      setState('unsupported');
      setError(ERROR_COPY.unsupported!);
      return;
    }
    setState('starting');
    const t = new WebSpeechTranscriber({ speaker: () => currentSpeaker(speakerStore.get()), ...(callStartedAt ? { callStartedAt } : {}) });
    tx.current = t;
    offs.current.push(
      t.on('turn', (turn) => addTurn({ id: turn.id, speaker: turn.speaker, text: turn.text, final: turn.final, tMs: turn.tMs, ...(turn.durMs !== undefined ? { durMs: turn.durMs } : {}), via: turn.via })),
      t.on('state', (s) => setState(s === 'listening' ? 'listening' : s === 'error' ? 'error' : s === 'starting' ? 'starting' : 'off')),
      t.on('error', (err) => {
        setError(ERROR_COPY[err.code] ?? err.message);
        if (err.fatal) stop();
      }),
    );
    try {
      meter.current = await startLevelMeter();
    } catch {
      // The level ring is decoration; words still flow through Web Speech.
    }
    await t.start();
  }, [callStartedAt, stop, supported]);

  useEffect(() => stop, [stop]);
  return { state, error, start, stop, supported };
}
