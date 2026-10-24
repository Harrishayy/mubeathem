import type { Speaker } from '@cue/core';
import { createStore } from '../state/store';

/**
 * One mic for both sides: whoever holds Space is the rep, otherwise the mic is the prospect. A toggle can
 * lock it either way (a headset rep with the prospect on speaker, say).
 */
export interface SpeakerState {
  /** Space is held. */
  held: boolean;
  /** Fixed speaker, or null for push-to-talk. */
  locked: Speaker | null;
}

export type SpeakerAction = { type: 'down' } | { type: 'up' } | { type: 'lock'; speaker: Speaker | null } | { type: 'blur' };

export function speakerReducer(s: SpeakerState, a: SpeakerAction): SpeakerState {
  switch (a.type) {
    case 'down':
      return s.held ? s : { ...s, held: true };
    case 'up':
    case 'blur':
      return s.held ? { ...s, held: false } : s;
    case 'lock':
      return { held: false, locked: a.speaker };
  }
}

export function currentSpeaker(s: SpeakerState): Speaker {
  if (s.locked) return s.locked;
  return s.held ? 'rep' : 'prospect';
}

export const speakerStore = createStore<SpeakerState>({ held: false, locked: null });

export function dispatchSpeaker(a: SpeakerAction): void {
  speakerStore.set((s) => speakerReducer(s, a));
}

function typing(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t as HTMLElement).isContentEditable;
}

/** Wire Space to the switch for a window. Returns a cleanup. */
export function bindSpaceToTalk(win: Window): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || typing(e.target)) return;
    e.preventDefault();
    dispatchSpeaker({ type: 'down' });
  };
  const up = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    dispatchSpeaker({ type: 'up' });
  };
  const blur = () => dispatchSpeaker({ type: 'blur' });
  win.addEventListener('keydown', down);
  win.addEventListener('keyup', up);
  win.addEventListener('blur', blur);
  return () => {
    win.removeEventListener('keydown', down);
    win.removeEventListener('keyup', up);
    win.removeEventListener('blur', blur);
  };
}
