import { DEMO_SCRIPT, demoScript } from '@cue/core';
import { describe, expect, it } from 'vitest';
import { demoDurationMs, planDemo } from '../src/demo/plan';

describe('demo plan', () => {
  it('plays the chosen variant of DEMO_SCRIPT in order', () => {
    expect(planDemo('cold').map((s) => s.line)).toEqual(demoScript('cold'));
    expect(planDemo('warm').map((s) => s.line)).toEqual(demoScript('warm'));
    expect(planDemo('both').map((s) => s.line)).toEqual(DEMO_SCRIPT);
  });
  it('waits for a card only after prospect turns, and streams long lines', () => {
    for (const s of planDemo('cold')) {
      expect(s.waitForCard).toBe(s.line.speaker === 'prospect');
      if (s.interim) expect(s.line.text.startsWith(s.interim)).toBe(true);
    }
    expect(planDemo('cold').some((s) => s.interim)).toBe(true);
  });
  it('is deterministic and scales with speed', () => {
    expect(planDemo('cold', 1)).toEqual(planDemo('cold', 1));
    const slow = demoDurationMs(planDemo('cold', 1), 1);
    const fast = demoDurationMs(planDemo('cold', 2), 2);
    expect(fast).toBeLessThan(slow * 0.55);
    // A natural run fits a demo slot (≈ 1–2 minutes before server time).
    expect(slow).toBeGreaterThan(45_000);
    expect(slow).toBeLessThan(150_000);
  });
});
