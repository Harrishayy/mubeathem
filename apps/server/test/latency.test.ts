import type { CallEvent, Suggestion } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { loadConfig, type ServerConfig } from '../src/config';
import { lateCardAllowed, StandbyCache, standbyMoments, swapDecision, type ShownCard, type StandbyEntry, type StandbyLine } from '../src/pipeline/latency';
import { createCall, fakeMubit, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

const latency = (o: Partial<ServerConfig['latency']> = {}): ServerConfig['latency'] => ({ ...loadConfig({}).latency, standby: 0, ...o });
const versions = (s: CueServer, id: string) => s.cue.s.store.list(id).flatMap((e) => (e.type === 'suggestion.shown' ? [e.suggestion] : []));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves with the first event of `type` (and how long after `since` it arrived, wall clock). */
function nextEvent(s: CueServer, callId: string, type: CallEvent['type'], since = performance.now()): Promise<{ e: CallEvent; ms: number }> {
  return new Promise((resolve) => {
    const off = s.cue.s.store.subscribe(callId, (e) => {
      if (e.type !== type) return;
      off();
      resolve({ e, ms: performance.now() - since });
    });
  });
}

/* ───────── swap policy ───────── */

describe('swapDecision', () => {
  const shown: ShownCard = { moment: 'objection_broker', confidence: 0.85, say: 'Who re-quotes you after a raise?', servedBy: 'rules', shownAt: 1000 };
  const ctx = { now: 1200, repSpokeAt: null, acted: false, windowMs: 500 };
  const next = { moment: 'objection_broker' as const, confidence: 0.8, say: 'Fair. Did your broker re-quote D&O after the Series A?', servedBy: 'mubit' as const };

  it('upgrades the wording when the moment holds', () => {
    expect(swapDecision(shown, next, ctx)).toEqual({ swap: true, reason: 'upgrade' });
  });
  it('never once the rep acted on the card or started talking', () => {
    expect(swapDecision(shown, next, { ...ctx, acted: true })).toEqual({ swap: false, reason: 'acted' });
    expect(swapDecision(shown, next, { ...ctx, repSpokeAt: 1100 })).toEqual({ swap: false, reason: 'rep_speaking' });
    // Rep speech in the future (clock skew) does not lock it yet.
    expect(swapDecision(shown, next, { ...ctx, repSpokeAt: 1300 }).swap).toBe(true);
  });
  it('never after the window', () => {
    expect(swapDecision(shown, next, { ...ctx, now: 1501 })).toEqual({ swap: false, reason: 'too_late' });
    expect(swapDecision(shown, next, { ...ctx, now: 1500 }).swap).toBe(true);
  });
  it('never a downgrade, and no change for the same words', () => {
    expect(swapDecision({ ...shown, servedBy: 'cache' }, { ...next, servedBy: 'rules' }, ctx)).toEqual({ swap: false, reason: 'not_better' });
    expect(swapDecision(shown, { ...next, say: ` ${shown.say} ` }, ctx)).toEqual({ swap: false, reason: 'same_text' });
  });
  it('a different moment: a sure model read corrects a rules card; a weak one does not', () => {
    expect(swapDecision(shown, { ...next, moment: 'buying_signal', confidence: 0.7 }, ctx)).toEqual({ swap: true, reason: 'correct' });
    expect(swapDecision(shown, { ...next, moment: 'buying_signal', confidence: 0.5 }, ctx)).toEqual({ swap: false, reason: 'keep_moment' });
    // A weak instant read may always be corrected.
    expect(swapDecision({ ...shown, confidence: 0.4 }, { ...next, moment: 'buying_signal', confidence: 0.5 }, ctx).swap).toBe(true);
    // Model vs model: only when clearly surer.
    const mshown = { ...shown, servedBy: 'mubit' as const };
    expect(swapDecision(mshown, { ...next, moment: 'buying_signal', confidence: 0.9 }, ctx).swap).toBe(false);
    expect(swapDecision(mshown, { ...next, moment: 'buying_signal', confidence: 0.96 }, ctx).swap).toBe(true);
  });
  it('a card nobody saw may appear late only until the rep replies', () => {
    expect(lateCardAllowed({ now: 2000, repSpokeAt: null })).toBe(true);
    expect(lateCardAllowed({ now: 2000, repSpokeAt: 1900 })).toBe(false);
  });
});

/* ───────── standby cache ───────── */

describe('StandbyCache', () => {
  const line = { say: 'Tailored broker line', why: 'w', upNext: [], chosen: {} as StandbyLine['chosen'], requestId: 'mreq_1' } satisfies StandbyLine;
  const entry = (o: Partial<StandbyEntry> = {}): StandbyEntry => ({
    moment: 'objection_broker',
    persona: 'ceo',
    turnCount: 3,
    createdAt: 1000,
    ranked: [],
    controller: new AbortController(),
    promise: Promise.resolve(line),
    ready: null,
    settled: false,
    ...o,
  });

  it('serves a finished line once, for the same moment and persona', async () => {
    const c = new StandbyCache();
    c.put('call_1', entry());
    expect(c.takeReady('call_1', 'objection_broker', 'ceo', 4, 2000)).toBeNull(); // still writing
    await sleep(0);
    expect(c.takeReady('call_1', 'objection_broker', 'cfo', 4, 2000)).toBeNull();
    expect(c.takeReady('call_1', 'objection_price', 'ceo', 4, 2000)).toBeNull();
    expect(c.takeReady('call_1', 'objection_broker', 'ceo', 4, 2000)?.say).toBe('Tailored broker line');
    expect(c.takeReady('call_1', 'objection_broker', 'ceo', 4, 2000)).toBeNull();
    expect(c.hits).toBe(1);
  });

  it('goes stale after a few prospect turns or two minutes, and is per call', async () => {
    const c = new StandbyCache(3, 120_000);
    c.put('call_1', entry());
    await sleep(0);
    expect(c.takeReady('call_2', 'objection_broker', 'ceo', 4, 2000)).toBeNull();
    expect(c.has('call_1', 'objection_broker', 'ceo', 7, 2000)).toBe(false);
    expect(c.has('call_1', 'objection_broker', 'ceo', 6, 121_001)).toBe(false);
    expect(c.has('call_1', 'objection_broker', 'ceo', 6, 2000)).toBe(true);
  });

  it('a pending write can be taken over by the refinement; clear aborts what is in flight', () => {
    const c = new StandbyCache();
    let resolve!: (l: StandbyLine) => void;
    const e = entry({ promise: new Promise<StandbyLine>((r) => (resolve = r)) });
    c.put('call_1', e);
    expect(c.takePending('call_1', 'objection_broker', 'ceo', 4, 2000)).toBe(e);
    expect(c.size('call_1')).toBe(0);
    const e2 = entry({ promise: new Promise<StandbyLine>(() => {}) });
    c.put('call_1', e2);
    c.clear('call_1');
    expect(e2.controller.signal.aborted).toBe(true);
    resolve(line);
  });

  it('standbyMoments: the current moment first, then predictions, only moments that speak', () => {
    const up = [
      { ifTheySay: 'a', move: 'b', moment: 'objection_price' as const },
      { ifTheySay: 'c', move: 'd', moment: 'small_talk' as const },
      { ifTheySay: 'e', move: 'f', moment: 'close' as const },
    ];
    expect(standbyMoments('objection_broker', up, 2, (m) => m !== 'small_talk')).toEqual(['objection_broker', 'objection_price']);
    expect(standbyMoments('objection_broker', up, 3, (m) => m !== 'small_talk')).toEqual(['objection_broker', 'objection_price', 'close']);
    expect(standbyMoments('objection_broker', up, 0, () => true)).toEqual([]);
  });
});

/* ───────── the pipeline with the latency layers ───────── */

describe('instant card', () => {
  it('rules only: a card ≤ 50 ms after a final prospect turn, in process', async () => {
    server = testServer({ mubit: null });
    const id = await createCall(server);
    await server.cue.idle();
    const times: number[] = [];
    for (const text of ["What's this regarding?", 'We already have a broker.', 'Roughly how much would that cost?']) {
      const shown = nextEvent(server, id, 'suggestion.shown');
      server.cue.addTurn(id, { speaker: 'prospect', text, final: true, via: 'typed' } as Parameters<typeof server.cue.addTurn>[1]);
      times.push((await shown).ms);
      await server.cue.idle();
    }
    expect(Math.max(...times)).toBeLessThanOrEqual(50);
    expect(versions(server, id).every((s) => s.servedBy === 'rules')).toBe(true);
  });

  it('with a slow Mubit: instant rules card ≤ 50 ms, then the same card id refined in place', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 150, write_line: 150 },
      outputs: { write_line: (i) => ({ say: `Tailored: ${i.candidates[0]!.text}`, why: 'w', line_id: i.candidates[0]!.line_id, up_next: [], risky_claim: null }) },
    });
    server = testServer({ mubit, config: { latency: latency() } });
    const id = await createCall(server);
    await server.cue.idle();
    const shown = nextEvent(server, id, 'suggestion.shown');
    server.cue.addTurn(id, { speaker: 'prospect', text: 'We already have a broker.', final: true, via: 'typed' } as Parameters<typeof server.cue.addTurn>[1]);
    const first = await shown;
    expect(first.ms).toBeLessThanOrEqual(50);
    await server.cue.idle();
    const v = versions(server, id);
    expect(v).toHaveLength(2);
    expect(v[0]!.id).toBe(v[1]!.id);
    expect(v[0]).toMatchObject({ stage: 'instant', servedBy: 'rules' });
    expect(v[1]).toMatchObject({ stage: 'refined', servedBy: 'mubit', writePath: 'speculative' });
    expect(v[1]!.say).toMatch(/^Tailored:/);
    expect(v[1]!.latencyMs).toBe(v[0]!.latencyMs);
    expect(v[1]!.refinedLatencyMs).toBeGreaterThanOrEqual(140);
    const view = server.cue.getCall(id);
    expect(view.history).toHaveLength(1);
    expect(view.current?.say).toBe(v[1]!.say);
    // Every Mubit call is still traced.
    server.flushTraces();
    const traces = server.cue.s.db.prepare('SELECT task FROM mubit_traces WHERE session_id = ?').all(id) as { task: string }[];
    expect(traces.map((t) => t.task)).toEqual(expect.arrayContaining(['read_moment', 'write_line']));
  });

  it('never swaps under the rep: once they speak the instant card stays, and the tailored line is kept for next time', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 120, write_line: 120 },
      outputs: { write_line: (i) => ({ say: `Tailored: ${i.candidates[0]!.text}`, why: 'w', line_id: i.candidates[0]!.line_id, up_next: [], risky_claim: null }) },
    });
    server = testServer({ mubit, config: { latency: latency({ standby: 1 }) } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await sleep(20);
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_rep_1', speaker: 'rep', text: 'Makes sense', final: false });
    await server.cue.idle();
    const v = versions(server, id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ stage: 'instant', servedBy: 'rules' });
    expect(server.cue.turns.recentTimings(id).at(-1)?.refine).toBe('kept: rep_speaking');
    // Same objection again: the recycled tailored line is the instant card.
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Like I said, our broker handles all of it.' });
    await sleep(5);
    const next = versions(server, id).at(-1)!;
    expect(next).toMatchObject({ stage: 'instant', servedBy: 'cache', precomputed: 'standby' });
    expect(next.say).toMatch(/^Tailored:/);
    await server.cue.idle();
  });

  it('standby: after a card, the predicted moments are pre-written and a matching turn is instant and tailored', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 30, write_line: 30 },
      outputs: {
        write_line: (i) => ({
          say: `Tailored ${i.situation.moment}: ${i.candidates[0]!.text}`,
          why: 'w',
          line_id: i.candidates[0]!.line_id,
          up_next: [{ if_they_say: 'How much is it?', move: 'Offer the quote call', moment: 'buying_signal' }],
          risky_claim: null,
        }),
      },
    });
    server = testServer({ mubit, config: { latency: latency({ standby: 2 }) } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    expect(server.cue.turns.standby.size(id)).toBe(2);
    const shown = nextEvent(server, id, 'suggestion.shown');
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Roughly how much would something like that cost?' });
    const first = await shown;
    expect(first.ms).toBeLessThanOrEqual(50);
    const s = (first.e as Extract<CallEvent, { type: 'suggestion.shown' }>).suggestion;
    expect(s).toMatchObject({ servedBy: 'cache', precomputed: 'standby', stage: 'instant' });
    expect(s.say).toMatch(/^Tailored buying_signal:/);
    expect(s.mubitRequestIds.length).toBe(1);
    await server.cue.idle();
    // The model agreed: the standby card stands, no extra write for this turn's moment.
    expect(versions(server, id).filter((x) => x.id === s.id)).toHaveLength(1);
  });

  it('a late model card is skipped once the rep is already replying', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 80, write_line: 10 },
      outputs: { read_moment: (i) => ({ persona: 'ceo', persona_confidence: 0.8, receptivity: 'neutral', receptivity_score: 0, moment: 'objection_timing', moment_confidence: 0.8, tone: { engagement: 0.5, warmth: 0.5, patience: 0.5, interest: 0.5 }, signals: [], should_suggest: true, rationale: `fake ${i.window.length}` }) },
    });
    server = testServer({ mubit, config: { latency: latency() } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Hm, okay.' }); // rules: quiet
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_rep_x', speaker: 'rep', text: 'So', final: false });
    await server.cue.idle();
    expect(versions(server, id)).toHaveLength(0);
    expect(server.cue.s.store.list(id).some((e) => e.type === 'suggestion.skipped' && e.reason.startsWith('late'))).toBe(true);
  });
});

describe('early trigger (endpointing on interims)', () => {
  it('a punctuated interim shows the card before the final; the final adopts it (one read, one card)', async () => {
    const mubit = fakeMubit({ delayMs: { read_moment: 60, write_line: 60 } });
    server = testServer({ mubit, config: { latency: latency() } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text: 'We already have', final: false });
    expect(versions(server, id)).toHaveLength(0);
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text: 'We already have a broker.', final: false });
    await sleep(5);
    const early = versions(server, id);
    expect(early).toHaveLength(1);
    expect(early[0]!.turnId).toBe('turn_p1');
    expect(server.cue.getCall(id).turns.find((t) => t.id === 'turn_p1')?.final).toBe(false);
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text: 'We already have a broker.', final: true });
    await server.cue.idle();
    expect(new Set(versions(server, id).map((s) => s.id)).size).toBe(1);
    expect(mubit.count('read_moment')).toBe(1);
    expect(server.cue.s.store.list(id).filter((e) => e.type === 'situation.read')).toHaveLength(1);
  });

  it('the sentence growing with the same moment keeps the run; a new moment restarts it in place', async () => {
    const mubit = fakeMubit({ delayMs: { read_moment: 200, write_line: 200 } });
    server = testServer({ mubit, config: { latency: latency() } });
    const id = await createCall(server);
    await server.cue.idle();
    const say = (text: string, final = false) => post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text, final });
    await say('We already have a broker.');
    await sleep(5);
    await say('We already have a broker. They did our seed round.');
    await sleep(5);
    expect(mubit.count('read_moment')).toBe(1);
    await say('We already have a broker. They did our seed round. Honestly how much would it even cost?');
    await sleep(5);
    expect(mubit.count('read_moment')).toBe(2);
    const v = versions(server, id);
    expect(new Set(v.map((s) => s.id)).size).toBe(1); // replaced in place, same card id
    expect(v.at(-1)!.situation.moment).not.toBe('objection_broker');
    await say('We already have a broker. They did our seed round. Honestly how much would it even cost?', true);
    await server.cue.idle();
    expect(mubit.count('read_moment')).toBe(2);
  });

  it('an unpunctuated interim (Web Speech) triggers after the endpoint pause', async () => {
    server = testServer({ mubit: null, config: { latency: latency({ endpointPauseMs: 80 }) } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text: 'we already have a broker', final: false });
    await sleep(30);
    expect(versions(server, id)).toHaveLength(0);
    await sleep(90);
    expect(versions(server, id)).toHaveLength(1);
    expect(versions(server, id)[0]!.situation.moment).toBe('objection_broker');
  });

  it('CUE_EARLY_TRIGGER=0: interims never start the pipeline', async () => {
    server = testServer({ mubit: null, config: { latency: latency({ earlyTrigger: false }) } });
    const id = await createCall(server);
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { id: 'turn_p1', speaker: 'prospect', text: 'We already have a broker.', final: false });
    await sleep(20);
    expect(versions(server, id)).toHaveLength(0);
  });
});

describe('suggestion schema', () => {
  it('stage, refinedAt, refinedLatencyMs and precomputed are optional and validated', async () => {
    const { Suggestion: Z } = await import('@cue/core');
    const s: Partial<Suggestion> = { stage: 'refined', refinedAt: 1, refinedLatencyMs: 2, precomputed: 'standby' };
    expect(Z.shape.stage.safeParse(s.stage).success).toBe(true);
    expect(Z.shape.stage.safeParse('draft').success).toBe(false);
  });
});
