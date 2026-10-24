import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, repIdFor, saveSettings, SETTINGS_KEY } from '../src/state/settings';

const throwing = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };

describe('settings persistence', () => {
  it('falls back to defaults when storage throws', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false);
  });
  it('falls back when storage is missing or holds junk', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => '{not json', setItem: () => {} })).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips and drops fields of the wrong type or value', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(saveSettings({ ...DEFAULT_SETTINGS, direction: 'night', debug: true }, store)).toBe(true);
    expect(loadSettings(store).direction).toBe('night');
    expect(loadSettings(store).debug).toBe(true);
    mem.set(SETTINGS_KEY, JSON.stringify({ direction: 'neon', theme: 3, demoSpeed: 2, repName: 'Sam' }));
    const s = loadSettings(store);
    expect(s.direction).toBe('honey');
    expect(s.theme).toBe('system');
    expect('demoSpeed' in s).toBe(false);
    expect(s.repName).toBe('Sam');
  });
  it('derives a rep id from a typed name', () => {
    expect(repIdFor("Sam O'Neil")).toBe('rep_sam_o_neil');
    expect(repIdFor('  José  Núñez ')).toBe('rep_jose_nunez');
    expect(repIdFor('   ')).toBe('');
  });
});
