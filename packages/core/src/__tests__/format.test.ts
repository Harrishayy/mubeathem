import { describe, expect, it } from 'vitest';
import { formatDuration, formatMultiplier, formatPercent, truncateWords } from '../format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(134_000)).toBe('02:14');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(3_734_000)).toBe('1:02:14');
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });

  it('formats percents', () => {
    expect(formatPercent(0.4123)).toBe('41%');
    expect(formatPercent(1.5)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
  });

  it('formats multipliers', () => {
    expect(formatMultiplier(2.09)).toBe('2.1×');
    expect(formatMultiplier(2)).toBe('2.0×');
    expect(formatMultiplier(12.4)).toBe('12×');
    expect(formatMultiplier(Number.POSITIVE_INFINITY)).toBe('0×');
  });

  it('truncates on word boundaries', () => {
    expect(truncateWords('one two three four', 2)).toBe('one two…');
    expect(truncateWords('Honestly, insurance.', 1)).toBe('Honestly…');
    expect(truncateWords('  short   line ', 5)).toBe('short line');
  });
});
