import { describe, expect, it } from 'vitest';
import { buildDispositionMap, DEFAULT_DISPOSITION_MAP, extractVocabulary, learnDispositions, mapDisposition } from '../src';
import { FIXTURE_BOOTSTRAP } from '../src/fixtures';

describe('mapDisposition', () => {
  it('maps the default vocabulary', () => {
    expect(mapDisposition('Demo booked')).toBe('meeting_booked');
    expect(mapDisposition('Meeting set')).toBe('meeting_booked');
    expect(mapDisposition('Follow up')).toBe('follow_up');
    expect(mapDisposition('Gatekeeper')).toBe('gatekeeper_blocked');
    expect(mapDisposition('Left voicemail')).toBe('voicemail');
    expect(mapDisposition('Wrong person')).toBe('wrong_person');
    expect(mapDisposition('Call back')).toBe('callback_requested');
  });

  it('is case-, space- and punctuation-insensitive', () => {
    expect(mapDisposition('  MEETING   BOOKED ')).toBe('meeting_booked');
    expect(mapDisposition('follow-up')).toBe('follow_up');
    expect(mapDisposition('Callback')).toBe('callback_requested');
    expect(mapDisposition('not_interested')).toBe('not_interested');
  });

  it('unknown, empty and missing → unknown', () => {
    expect(mapDisposition('Bad Timing - Q1')).toBe('unknown');
    expect(mapDisposition('')).toBe('unknown');
    expect(mapDisposition(undefined)).toBe('unknown');
  });
});

describe('account vocabulary from /bootstrap', () => {
  it('extracts disposition, sentiment and purpose strings', () => {
    const v = extractVocabulary(FIXTURE_BOOTSTRAP);
    expect(v.dispositions).toHaveLength(12);
    expect(v.dispositions).toContain('Not Interested - Has Broker');
    expect(v.sentiments).toEqual(['Positive', 'Neutral', 'Negative']);
    expect(v.purposes).toContain('Renewal');
  });

  it('copes with other plausible shapes', () => {
    expect(extractVocabulary({ dispositions: ['Booked', 'Nope'] }).dispositions).toEqual(['Booked', 'Nope']);
    expect(extractVocabulary({ account: { config: { userLogDispositionOptions: [{ name: 'Demo Set' }, { value: 'VM' }] } } }).dispositions).toEqual(['Demo Set', 'VM']);
    expect(extractVocabulary(null).dispositions).toEqual([]);
  });

  it('learns the account strings with how each was mapped', () => {
    const learned = Object.fromEntries(learnDispositions(FIXTURE_BOOTSTRAP).map((d) => [d.raw, d]));
    expect(learned['Meeting Booked']).toMatchObject({ outcome: 'meeting_booked', via: 'default' });
    expect(learned['Interested - Follow Up']).toMatchObject({ outcome: 'follow_up', via: 'keyword' });
    expect(learned['Not Interested - Has Broker']).toMatchObject({ outcome: 'not_interested', via: 'keyword' });
    expect(learned['Gatekeeper - Blocked']).toMatchObject({ outcome: 'gatekeeper_blocked', via: 'keyword' });
    expect(learned['Bad Timing - Q1']).toMatchObject({ outcome: 'unknown', via: 'unmapped' });
  });

  it('buildDispositionMap: account labels map exactly; overrides win', () => {
    const map = buildDispositionMap(FIXTURE_BOOTSTRAP, { 'bad timing - q1': 'callback_requested', 'Send Info': 'not_interested' });
    expect(mapDisposition('Interested - Follow Up', map)).toBe('follow_up');
    expect(mapDisposition('gatekeeper-blocked', map)).toBe('gatekeeper_blocked');
    expect(mapDisposition('Bad Timing - Q1', map)).toBe('callback_requested');
    expect(mapDisposition('Send Info', map)).toBe('not_interested');
    // Defaults still apply; labels never seen stay unknown.
    expect(mapDisposition('Demo booked', map)).toBe('meeting_booked');
    expect(mapDisposition('Something new', map)).toBe('unknown');
    // The defaults themselves are untouched.
    expect(mapDisposition('Send Info', DEFAULT_DISPOSITION_MAP)).toBe('follow_up');
  });
});
