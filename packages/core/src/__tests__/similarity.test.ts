import { describe, expect, it } from 'vitest';
import { lineSimilarity, matchUsage } from '../playbook/similarity';

describe('lineSimilarity', () => {
  const line = 'Makes sense, most founders do. When did they last re-quote you after a raise?';

  it('is 1 for the same words regardless of case and punctuation', () => {
    expect(lineSimilarity(line, line)).toBe(1);
    expect(lineSimilarity('Makes sense!', 'makes   SENSE')).toBe(1);
    expect(lineSimilarity('That’s fair', "That's fair")).toBe(1);
  });

  it('is symmetric and in 0..1', () => {
    const b = 'Most founders do. When did your broker last re-quote you?';
    expect(lineSimilarity(line, b)).toBeCloseTo(lineSimilarity(b, line), 10);
    expect(lineSimilarity(line, b)).toBeGreaterThan(0.5);
    expect(lineSimilarity(line, b)).toBeLessThan(1);
  });

  it('is high for a light paraphrase and low for unrelated lines', () => {
    expect(lineSimilarity(line, 'Makes sense, most founders do. When did they last requote you after the raise?')).toBeGreaterThan(0.8);
    expect(lineSimilarity(line, 'Thursday works, send me the invite.')).toBeLessThan(0.3);
  });

  it('handles empty input', () => {
    expect(lineSimilarity('', '')).toBe(1);
    expect(lineSimilarity('', 'hi')).toBe(0);
    expect(lineSimilarity('...', 'hi')).toBe(0);
  });
});

describe('matchUsage', () => {
  const shown = ["Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", 'Easiest is fifteen minutes with our team. Thursday or Friday?'];

  it('finds the line the rep said, even inside a longer turn', () => {
    expect(matchUsage('Honestly? Insurance. Worst cold call topic there is. Give me thirty seconds and I will let you go.', shown)?.index).toBe(0);
    expect(matchUsage('Right, so, easiest is fifteen minutes with our team, are you free Thursday or Friday this week?', shown)?.index).toBe(1);
  });

  it('returns null when nothing was said like it', () => {
    expect(matchUsage('Yeah that would definitely be covered.', shown)).toBeNull();
    expect(matchUsage('', shown)).toBeNull();
    expect(matchUsage('anything', [])).toBeNull();
  });
});
