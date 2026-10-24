import { describe, expect, it } from 'vitest';
import { levelFromFrame } from '../src/capture/level';
import { currentSpeaker, speakerReducer, type SpeakerState } from '../src/capture/speaker';

describe('speaker switch (hold Space = rep)', () => {
  const idle: SpeakerState = { held: false, locked: null };
  it('is the prospect unless Space is held', () => {
    expect(currentSpeaker(idle)).toBe('prospect');
    const held = speakerReducer(idle, { type: 'down' });
    expect(currentSpeaker(held)).toBe('rep');
    expect(currentSpeaker(speakerReducer(held, { type: 'up' }))).toBe('prospect');
  });
  it('releases on window blur so a lost keyup never sticks', () => {
    expect(currentSpeaker(speakerReducer({ held: true, locked: null }, { type: 'blur' }))).toBe('prospect');
  });
  it('a lock wins over Space and clears it', () => {
    const locked = speakerReducer({ held: true, locked: null }, { type: 'lock', speaker: 'rep' });
    expect(locked).toEqual({ held: false, locked: 'rep' });
    expect(currentSpeaker(speakerReducer(locked, { type: 'down' }))).toBe('rep');
    expect(currentSpeaker(speakerReducer(locked, { type: 'lock', speaker: null }))).toBe('prospect');
  });
  it('returns the same state for no-op actions', () => {
    expect(speakerReducer(idle, { type: 'up' })).toBe(idle);
  });
});

describe('voice level', () => {
  it('is 0 for silence and grows with amplitude, capped at 1', () => {
    expect(levelFromFrame(new Uint8Array(512).fill(128))).toBe(0);
    const quiet = levelFromFrame(Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 6 : -6)));
    const loud = levelFromFrame(Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 60 : -60)));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(levelFromFrame(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
    expect(levelFromFrame(new Uint8Array(0))).toBe(0);
  });
});
