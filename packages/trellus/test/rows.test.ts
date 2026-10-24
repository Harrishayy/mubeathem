import { describe, expect, it } from 'vitest';
import { Turn } from '@cue/core';
import { microsToMs, msToMicros, msToSeconds, parseJsonText, rowsToObjects, secondsToMs, SessionDetail, transcriptFromRow, transcriptFromSession } from '../src';
import { FIXTURE_SESSION, FIXTURE_SESSION_LIST, FIXTURE_SESSION_LIST_SELECT } from '../src/fixtures';

describe('units', () => {
  it('requests use µs, rows use seconds, Cue uses ms', () => {
    const ms = Date.parse('2026-10-01T00:00:00Z');
    expect(msToMicros(ms)).toBe(Date.parse('2026-10-01T00:00:00Z') * 1000); // the docs' JS recipe
    expect(msToMicros(ms)).toBe(1790812800000000); // the docs' sample start
    expect(microsToMs(1791417600000000)).toBe(Date.parse('2026-10-08T00:00:00Z'));
    expect(secondsToMs(1791849600)).toBe(new Date(1791849600 * 1000).getTime());
    expect(secondsToMs(2.45)).toBe(2450);
    expect(msToSeconds(ms + 999)).toBe(1790812800);
  });
});

describe('rowsToObjects', () => {
  it('maps cell i to select[i]', () => {
    const select = ['session_id', 'started_at', 'customer_data.name'];
    expect(rowsToObjects(select, [['CALL_ID', 1791849600, 'Example contact']])).toEqual([
      { session_id: 'CALL_ID', started_at: 1791849600, 'customer_data.name': 'Example contact' },
    ]);
  });

  it('handles [] and short rows, and rejects non-array rows', () => {
    expect(rowsToObjects(['a'], [])).toEqual([]);
    expect(rowsToObjects(['a', 'b'], [['x']])).toEqual([{ a: 'x', b: undefined }]);
    expect(() => rowsToObjects(['a'], [{ a: 1 }])).toThrow(TypeError);
  });

  it('reads the fixture list', () => {
    const calls = rowsToObjects(FIXTURE_SESSION_LIST_SELECT, FIXTURE_SESSION_LIST);
    expect(calls).toHaveLength(6);
    expect(calls.map((c) => c['user_log.disposition'])).toContain('Meeting Booked');
  });
});

describe('transcript alignment', () => {
  it('joins texts, is_customers and starts by index: true = prospect, offsets s → ms', () => {
    const turns = transcriptFromRow({
      session_id: 'S1',
      'turn_data.texts': ['Hello, this is Priya.', 'Hi Priya, Jordan from Corgi.', ''],
      'turn_data.is_customers': [true, false, true],
      'turn_data.starts': [0.5, 2.25, 4],
      'turn_data.ends': [1.75, 4.0, 5],
    });
    expect(turns).toEqual([
      { id: 'turn_S1_0', speaker: 'prospect', text: 'Hello, this is Priya.', tMs: 500, durMs: 1250, final: true, via: 'trellus' },
      { id: 'turn_S1_1', speaker: 'rep', text: 'Hi Priya, Jordan from Corgi.', tMs: 2250, durMs: 1750, final: true, via: 'trellus' },
    ]);
    for (const t of turns) expect(Turn.safeParse(t).success).toBe(true);
  });

  it('copes with misaligned or missing columns', () => {
    const turns = transcriptFromRow({ session_id: 'S2', 'turn_data.texts': ['a', 'b', 'c'], 'turn_data.is_customers': [false, true], 'turn_data.starts': [1] });
    expect(turns.map((t) => [t.speaker, t.tMs])).toEqual([
      ['rep', 1000],
      ['prospect', 1000],
    ]);
    expect(transcriptFromRow({ session_id: 'S3' })).toEqual([]);
  });

  it('reads /session camelCase turnData the same way', () => {
    const detail = SessionDetail.parse(FIXTURE_SESSION);
    const turns = transcriptFromSession(detail);
    expect(turns).toHaveLength(12);
    expect(turns[0]!.speaker).toBe('rep');
    expect(turns[1]!.speaker).toBe('prospect');
    expect(turns[0]!.tMs).toBe(24200);
  });
});

describe('parseJsonText', () => {
  it('parses custom_fields JSON text, tolerating junk', () => {
    expect(parseJsonText('{"email":"a@b.c"}')).toEqual({ email: 'a@b.c' });
    expect(parseJsonText('')).toEqual({});
    expect(parseJsonText('not json')).toEqual({});
    expect(parseJsonText('[1,2]')).toEqual({});
  });
});
