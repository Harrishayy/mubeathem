import { describe, expect, it } from 'vitest';
import { idTime, newId } from '../ids';
import { Id } from '../schema/domain';
import { seededRng } from '../text';

describe('newId', () => {
  it('has the prefix and a 26-char ULID body', () => {
    for (const prefix of ['call', 'turn', 'sug', 'line', 'evt'] as const) {
      const id = newId(prefix);
      expect(id).toMatch(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
      expect(Id.safeParse(id).success).toBe(true);
    }
  });

  it('sorts by time, and stays monotonic within one millisecond', () => {
    const a = newId('call', { now: 1_000 });
    const b = newId('call', { now: 2_000 });
    expect(a < b).toBe(true);
    const same = Array.from({ length: 50 }, () => newId('turn', { now: 5_000 }));
    expect([...same].sort()).toEqual(same);
    expect(new Set(same).size).toBe(50);
  });

  it('round-trips its time', () => {
    const now = Date.UTC(2026, 9, 24, 9, 30);
    expect(idTime(newId('sug', { now }))).toBe(now);
    expect(idTime('call_demo_lumen')).toBeNull();
  });

  it('is deterministic with a seeded rng', () => {
    expect(newId('line', { now: 1, rng: seededRng(5) })).toBe(newId('line', { now: 1, rng: seededRng(5) }));
  });
});
