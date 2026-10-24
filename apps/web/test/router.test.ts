import { describe, expect, it } from 'vitest';
import { hrefFor, parseHash } from '../src/router';

describe('hash routes', () => {
  it('parses every screen', () => {
    for (const n of ['live', 'practice', 'playbook', 'model', 'history', 'settings'] as const) expect(parseHash(`#/${n}`)).toEqual({ name: n });
    expect(parseHash('#/debrief/call_01ABC')).toEqual({ name: 'debrief', id: 'call_01ABC' });
    expect(parseHash('#/pip/call_9')).toEqual({ name: 'pip', id: 'call_9' });
    expect(parseHash('#/pip')).toEqual({ name: 'pip', id: null });
  });
  it('sends unknown or empty hashes to live', () => {
    expect(parseHash('')).toEqual({ name: 'live' });
    expect(parseHash('#/nope')).toEqual({ name: 'live' });
    expect(parseHash('#/debrief')).toEqual({ name: 'live' });
  });
  it('round-trips ids that need encoding', () => {
    const r = { name: 'debrief' as const, id: 'call_a/b c' };
    expect(parseHash(hrefFor(r))).toEqual(r);
  });
});
