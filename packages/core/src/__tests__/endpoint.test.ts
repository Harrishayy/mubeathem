import { describe, expect, it } from 'vitest';
import { endpointGuess, sameUtterance } from '../signals/endpoint';

describe('endpointGuess', () => {
  it('punctuated sentence ends are complete at once', () => {
    expect(endpointGuess('We already have a broker.', 0)).toMatchObject({ complete: true, reason: 'punctuation' });
    expect(endpointGuess("What's this regarding?", 0).complete).toBe(true);
    expect(endpointGuess('Yeah.', 0).complete).toBe(true);
  });

  it('a question mark wins even after a word sentences rarely end on', () => {
    expect(endpointGuess("What's this about?", 0).complete).toBe(true);
    expect(endpointGuess('Would that be covered by something like that?', 0).complete).toBe(true);
  });

  it('mid-thought partials wait twice the pause', () => {
    const g = endpointGuess('We already have a broker, and', 100, { pauseMs: 350 });
    expect(g).toMatchObject({ complete: false, reason: 'trailing', recheckInMs: 600 });
    expect(endpointGuess('We already have a broker,', 699, { pauseMs: 350 }).complete).toBe(false);
    expect(endpointGuess('We already have a broker,', 700, { pauseMs: 350 })).toMatchObject({ complete: true, reason: 'pause' });
    expect(endpointGuess('so the thing is um', 0).complete).toBe(false);
    expect(endpointGuess('I think it was the.', 0).complete).toBe(false);
  });

  it('unpunctuated partials (Web Speech) complete after the pause', () => {
    expect(endpointGuess('we already have a broker', 200, { pauseMs: 350 })).toMatchObject({ complete: false, reason: 'waiting', recheckInMs: 150 });
    expect(endpointGuess('we already have a broker', 350, { pauseMs: 350 })).toMatchObject({ complete: true, reason: 'pause' });
  });

  it('empty text never completes', () => {
    expect(endpointGuess('   ', 10_000)).toEqual({ complete: false, reason: 'empty', recheckInMs: null });
  });
});

describe('sameUtterance', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(sameUtterance('we already have a broker', 'We already have a broker.')).toBe(true);
    expect(sameUtterance("What's  this regarding?", 'whats this regarding')).toBe(true);
    expect(sameUtterance('we already have a broker', 'We already have a broker, they set it up.')).toBe(false);
  });
});
