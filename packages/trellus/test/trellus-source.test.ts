import { describe, expect, it } from 'vitest';
import { createTrellusClient, normalisePhone, phonesMatch, pickMatch, TrellusSource, type FindOutcomeQuery } from '../src';
import { createFakeTrellusFetch, FIXTURE_API_KEY, FIXTURE_IDS } from '../src/fixtures';
import { fakeClock, OCT_20, OCT_24 } from './helpers';

const prospect = (p: Partial<FindOutcomeQuery['prospect']>): FindOutcomeQuery['prospect'] => ({ name: '', title: '', company: '', facts: {}, ...p });

function source(nowMs = OCT_24, fakeOpts: Parameters<typeof createFakeTrellusFetch>[0] = {}) {
  const clock = fakeClock(nowMs);
  const fetch = createFakeTrellusFetch({ now: clock.now, ...fakeOpts });
  const client = createTrellusClient({ apiKey: FIXTURE_API_KEY, fetch, now: clock.now, sleep: clock.sleep });
  return { src: new TrellusSource({ client, now: clock.now }), fetch, clock };
}

describe('phone normalisation', () => {
  it('normalises common formats to E.164-ish', () => {
    expect(normalisePhone('+1 (415) 555-0142')).toBe('+14155550142');
    expect(normalisePhone('415.555.0142')).toBe('+14155550142');
    expect(normalisePhone('1-415-555-0142')).toBe('+14155550142');
    expect(normalisePhone('0044 20 7946 0958')).toBe('+442079460958');
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalisePhone('(415) 555-0142 x12')).toBe('+14155550142');
    expect(normalisePhone('555')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });

  it('matches across formats and a missing country code', () => {
    expect(phonesMatch('+1 (415) 555-0142', '4155550142')).toBe(true);
    expect(phonesMatch('+44 20 7946 0958', '020 7946 0958')).toBe(true); // national trunk 0 vs +44: same last 10 digits
    expect(phonesMatch('+44 20 7946 0958', '442079460958')).toBe(true);
    expect(phonesMatch('+1 415 555 0142', '+1 415 555 0143')).toBe(false);
  });
});

describe('TrellusSource.findOutcome', () => {
  const booked = Date.parse('2026-10-20T16:02:11Z');

  it('matches by phone in another format and maps the account disposition', async () => {
    const { src } = source();
    const rec = await src.findOutcome({ startedAt: booked + 40_000, prospect: prospect({ phone: '415-555-0142' }) });
    expect(rec).toMatchObject({ outcome: 'meeting_booked', source: 'trellus' });
    expect(rec!.raw['user_log.disposition']).toBe('Meeting Booked');
    expect(rec!.raw.session_id).toBe(FIXTURE_IDS.booked);
    expect(rec!.raw['user_log.sentiment']).toBe('Positive');
  });

  it('uses the account vocabulary from /bootstrap', async () => {
    const { src } = source();
    const rec = await src.findOutcome({ startedAt: Date.parse('2026-10-21T15:40:05Z'), prospect: prospect({ phone: '+1 415 555 0123' }) });
    expect(rec?.outcome).toBe('gatekeeper_blocked'); // "Gatekeeper - Blocked", learned by keyword
  });

  it('honours ±10 min of start', async () => {
    const { src } = source();
    const q = (offsetMs: number) => src.findOutcome({ startedAt: booked + offsetMs, prospect: prospect({ phone: '+14155550142' }) });
    expect(await q(9 * 60_000)).not.toBeNull();
    expect(await q(-9 * 60_000)).not.toBeNull();
    expect(await q(11 * 60_000)).toBeNull();
    expect(await q(-11 * 60_000)).toBeNull();
  });

  it('requests the window in µs with the call filter', async () => {
    const { src, fetch } = source();
    await src.findOutcome({ startedAt: booked, prospect: prospect({ phone: '+14155550142' }) });
    const body = JSON.parse(fetch.calls.find((c) => c.endpoint === 'sessionList')!.body!);
    expect(body.start).toBe((booked - 600_000) * 1000);
    expect(body.end).toBe((booked + 600_000 + 1) * 1000);
    expect(body.cnf).toEqual([[{ column_name: 'conversation_type', operator: 'EQ', value_safe: 1 }]]);
  });

  it('falls back to name + company (normalised) when there is no phone', async () => {
    const { src } = source();
    const rec = await src.findOutcome({ startedAt: Date.parse('2026-10-20T17:16:00Z'), prospect: prospect({ name: 'marcus feld', company: 'Tessellate Health' }) });
    expect(rec?.outcome).toBe('follow_up');
    const wrongCo = await src.findOutcome({ startedAt: Date.parse('2026-10-20T17:16:00Z'), prospect: prospect({ name: 'Marcus Feld', company: 'Another Co' }) });
    expect(wrongCo).toBeNull();
  });

  it('prefers the longest live duration when several sessions match', async () => {
    // Rachel Kim was dialled twice four minutes apart: a no-answer, then the real conversation.
    const { src } = source();
    const rec = await src.findOutcome({ startedAt: Date.parse('2026-10-22T19:42:00Z'), prospect: prospect({ phone: '(212) 555-0164' }) });
    expect(rec?.outcome).toBe('not_interested');
    expect(rec?.raw.session_id).toBe(FIXTURE_IDS.notInterested);
  });

  it('breaks live-duration ties by the closest start', () => {
    const rows = [
      { session_id: 'far', started_at: 1000, customer_address: '+14155550142', 'dial_metric.live_duration': 50 },
      { session_id: 'near', started_at: 1100, customer_address: '+14155550142', 'dial_metric.live_duration': 50 },
    ];
    expect(pickMatch(rows, { startedAt: 1_120_000, prospect: prospect({ phone: '4155550142' }) })?.session_id).toBe('near');
  });

  it('returns null while the rep has not dispositioned yet', async () => {
    const { src } = source(OCT_24, {
      records: [{ session_id: 'pending', started_at: 1792512000, conversation_type: 'CONVERSATION_TYPE_CALL', customer_address: '+14155550142', 'user_log.disposition': '', 'dial_metric.live_duration': 80 }],
    });
    expect(await src.findOutcome({ startedAt: 1792512000_000, prospect: prospect({ phone: '+14155550142' }) })).toBeNull();
  });

  it('still maps with the defaults if /bootstrap fails', async () => {
    const { src } = source(OCT_24, { intercept: (r) => (r.endpoint === 'bootstrap' ? new Response('boom', { status: 400 }) : undefined) });
    const rec = await src.findOutcome({ startedAt: booked, prospect: prospect({ phone: '+14155550142' }) });
    expect(rec?.outcome).toBe('meeting_booked');
  });
});

describe('TrellusSource.listRecent', () => {
  it('pulls connected calls (type 1, live ≥ 30 s) with transcripts and rep names', async () => {
    const { src, fetch } = source();
    const calls = await src.listRecent({ since: OCT_20 });
    const body = JSON.parse(fetch.calls.find((c) => c.endpoint === 'sessionList')!.body!);
    expect(body.cnf).toEqual([
      [{ column_name: 'conversation_type', operator: 'EQ', value_safe: 1 }],
      [{ column_name: 'dial_metric.live_duration', operator: 'GE', value_safe: 30 }],
    ]);
    expect(body.select).toEqual(expect.arrayContaining(['turn_data.texts', 'turn_data.is_customers', 'turn_data.starts']));
    // Voicemail (18 s live), the no-answer dial and the LinkedIn message are excluded.
    expect(calls.map((c) => c.trellusSessionId)).toEqual([FIXTURE_IDS.notInterested, FIXTURE_IDS.emailBrushOff, FIXTURE_IDS.gatekeeper, FIXTURE_IDS.broker, FIXTURE_IDS.booked]);
    const booked = calls.find((c) => c.trellusSessionId === FIXTURE_IDS.booked)!;
    expect(booked.startedAt).toBe(Date.parse('2026-10-20T16:02:11Z'));
    expect(booked.durationMs).toBe(238_400);
    expect(booked.rep).toEqual({ id: 'usr_7f3a1c', name: 'Jordan Ellis' });
    expect(booked.prospect).toMatchObject({ name: 'Priya Raman', company: 'Lumenfold AI', phone: '+1 (415) 555-0142', email: 'priya@lumenfold.example' });
    expect(booked.prospect.facts).toMatchObject({ funding_stage: 'Series A', company_url: 'https://lumenfold.example' });
    expect(booked.turns).toHaveLength(12);
    expect(booked.outcome?.outcome).toBe('meeting_booked');
    expect(booked.raw).not.toHaveProperty('turn_data.texts');
    expect(booked.raw['sales_metric.has_meeting_confirm']).toBe(true);
    const email = calls.find((c) => c.trellusSessionId === FIXTURE_IDS.emailBrushOff)!;
    expect(email.prospect.email).toBe('tom@fernway.example');
    expect(email.outcome?.outcome).toBe('follow_up');
  });
});
