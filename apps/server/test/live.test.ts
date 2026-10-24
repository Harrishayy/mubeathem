import type { Brief, LiveCueInput, Suggestion } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { loadConfig } from '../src/config';
import { NEW_LINE_ID } from '../src/pipeline/live';
import { createCall, fakeMubit, json, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

const LIVE = { pipeline: 'live' as const, latency: { ...loadConfig({}).latency, standby: 0 } };

const events = (s: CueServer, id: string) => s.cue.s.store.list(id);
/** Every version of every card, in order. */
const versions = (s: CueServer, id: string) => events(s, id).flatMap((e) => (e.type === 'suggestion.shown' ? [e.suggestion] : []));
const latest = (s: CueServer, id: string) => {
  const byId = new Map<string, Suggestion>();
  for (const c of versions(s, id)) byId.set(c.id, c);
  return [...byId.values()];
};
const skips = (s: CueServer, id: string) => events(s, id).flatMap((e) => (e.type === 'suggestion.skipped' ? [e.reason] : []));
const turn = (id: string, body: Record<string, unknown>) => post(server, `/api/calls/${id}/turns`, body);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('live pipeline (CUE_PIPELINE=live)', () => {
  it('one streamed live_cue call per turn: the card goes up when the line is written, then fills in', async () => {
    const mubit = fakeMubit({ delayMs: { live_cue: 100 } });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'rep', text: "Hi Maya, it's Alex from Corgi." });
    await turn(id, { speaker: 'prospect', text: "...what's this regarding?" });
    await server.cue.idle();

    expect(mubit.count('live_cue')).toBe(1);
    expect(mubit.count('read_moment') + mubit.count('write_line')).toBe(0);
    const v = versions(server, id);
    expect(v).toHaveLength(2);
    expect(v[0]!.id).toBe(v[1]!.id);
    // First version: the line, as soon as the stream had it (no why or up next yet).
    expect(v[0]!.upNext).toEqual([]);
    expect(v[0]!.stage).toBeUndefined();
    // Then the same card, complete.
    expect(v[1]!.stage).toBe('refined');
    expect(v[1]!.upNext.length).toBeGreaterThan(0);
    expect(v[1]!.servedBy).toBe('mubit');
    expect(v[1]!.situation.moment).toBe('whats_this_regarding');
    expect(v[1]!.lineId).toMatch(/^line_seed_/);
    expect(v[1]!.mubitRequestIds).toHaveLength(1);
    const read = events(server, id).find((e) => e.type === 'situation.read');
    expect(read).toMatchObject({ servedBy: 'mubit' });
    const t = server.cue.live!.recentTimings(id).at(-1)!;
    expect(t.outcome).toBe('shown');
    expect(t.cardMs!).toBeLessThan(t.doneMs!);
  });

  it('starts on an interim that looks finished and the final adopts it: no second model call', async () => {
    const mubit = fakeMubit({ delayMs: { live_cue: 60 } });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'rep', text: "Hi Maya, it's Alex from Corgi." });
    await turn(id, { id: 'turn_p1', speaker: 'prospect', text: "What's this regarding?", final: false });
    await sleep(120);
    expect(latest(server, id)).toHaveLength(1);
    await turn(id, { id: 'turn_p1', speaker: 'prospect', text: "What's this regarding?", final: true });
    await server.cue.idle();
    expect(mubit.count('live_cue')).toBe(1);
    const t = server.cue.live!.recentTimings(id).at(-1)!;
    expect(t.early).toBe(true);
    // The card was on screen before the final transcript arrived.
    expect(t.fromFinalMs!).toBeLessThanOrEqual(0);
  });

  it('the prospect carries on: the run restarts and the same card updates in place', async () => {
    const mubit = fakeMubit({ delayMs: { live_cue: 40 } });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { id: 'turn_p1', speaker: 'prospect', text: "What's this regarding?", final: false });
    await sleep(80);
    await turn(id, { id: 'turn_p1', speaker: 'prospect', text: "What's this regarding? We already have a broker.", final: true });
    await server.cue.idle();
    const cards = latest(server, id);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.situation.moment).toBe('objection_broker');
    expect(mubit.count('live_cue')).toBe(2);
  });

  it('a newer prospect turn supersedes the one in flight', async () => {
    const mubit = fakeMubit({ delayMs: { live_cue: 150 } });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: 'Hello?' });
    await sleep(20);
    await turn(id, { speaker: 'prospect', text: "Sorry, what's this regarding?" });
    await server.cue.idle();
    expect(skips(server, id)).toContain('superseded');
    expect(latest(server, id)).toHaveLength(1);
    expect(mubit.calls.some((c) => c.task === 'live_cue' && c.aborted)).toBe(true);
  });

  it('a quiet moment shows nothing and says why', async () => {
    server = testServer({ mubit: fakeMubit(), config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: "Hi, you've reached Maya. Leave a message after the tone." });
    await server.cue.idle();
    expect(latest(server, id)).toHaveLength(0);
    expect(skips(server, id).at(-1)).toMatch(/^quiet/);
  });

  it('no key: no rules card on the live path, and the error says so', async () => {
    server = testServer({ mubit: null, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    expect(latest(server, id)).toHaveLength(0);
    expect(events(server, id).some((e) => e.type === 'pipeline.error' && e.stage === 'live_cue')).toBe(true);
  });

  it('a model error leaves no card and is logged, never a made-up line', async () => {
    server = testServer({ mubit: fakeMubit({ fail: { live_cue: 'http' } }), config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    expect(latest(server, id)).toHaveLength(0);
    expect(skips(server, id).at(-1)).toBe('error: http');
  });

  it('a risky line is policy-checked before anyone sees it and swapped for a safe playbook line', async () => {
    const mubit = fakeMubit({
      delayMs: { live_cue: 30 },
      outputs: {
        live_cue: () => ({ meaning: 'asks if they are covered', moment: 'buying_signal', persona: 'ceo', receptivity: 'warm', line_id: 'none', say: "Yes, you'd definitely be covered for that.", why: 'answer it', up_next: [], risky_claim: 'definitely be covered' }),
      },
    });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: 'Would a customer suing us over a bug be covered?' });
    await server.cue.idle();
    const v = versions(server, id);
    expect(v.every((c) => !/definitely be covered/i.test(c.say))).toBe(true);
    expect(v.at(-1)!.lineId).toMatch(/^line_seed_/);
    expect(mubit.count('check_claim')).toBe(1);
  });

  it("a new line the model wrote carries no playbook id, so it can't skew a line's stats", async () => {
    const mubit = fakeMubit({
      outputs: { live_cue: () => ({ meaning: 'curious', moment: 'opener', persona: 'ceo', receptivity: 'warm', line_id: 'none', say: 'Thanks for picking up. Thirty seconds on why I called?', why: 'earn time', up_next: [], risky_claim: null }) },
    });
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: 'Maya speaking.' });
    await server.cue.idle();
    expect(latest(server, id)[0]!.lineId).toBe(NEW_LINE_ID);
    expect(latest(server, id)[0]!.evidence.basis).toBe('model');
  });

  it("the client's brief (PUT /brief) reaches the model, and the server skips its own research", async () => {
    const mubit = fakeMubit();
    server = testServer({ mubit, config: LIVE });
    const id = await createCall(server, { clientBrief: true });
    const brief: Brief = {
      summary: 'Seed-stage logistics software for freight brokers.',
      hooks: [],
      opener: "I saw you're matching freight brokers to carriers.",
      personaGuess: 'ceo',
      servedBy: 'client',
      corgi: { trigger: "you're matching freight brokers to carriers", risk: 'Software errors that lose shipments.', policies: [{ name: 'Technology E&O', reason: 'bugs in client contracts' }], people: [], sec: { form: 'D', line: 'Round still open — $1.3M of $9.9M left', sure: true }, facts: ['Employees 12'] },
    };
    const res = await server.app.request(`/api/calls/${id}/brief`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(brief) });
    expect(res.status).toBe(200);
    expect((await json(res)).brief.corgi.sec.line).toContain('$1.3M');
    await turn(id, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    expect(mubit.count('research_brief')).toBe(0);
    const input = mubit.calls.find((c) => c.task === 'live_cue')!.input as LiveCueInput;
    expect(input.brief.risk).toBe('Software errors that lose shipments.');
    expect(input.brief.facts[0]).toBe('Form D verified: Round still open — $1.3M of $9.9M left');
    expect(input.brief.policies).toEqual(['Technology E&O: bugs in client contracts']);
    expect(input.playbook.length).toBeGreaterThan(10);
    expect(input.transcript.at(-1)).toEqual({ speaker: 'prospect', text: "What's this regarding?" });
  });

  it('learns from the call: a booked call updates the lines used, and with auto-activate the rep\'s own line joins the playbook', async () => {
    server = testServer({ mubit: fakeMubit(), config: { ...LIVE, autoActivate: true } });
    const id = await createCall(server, { clientBrief: true });
    await turn(id, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const card = latest(server, id)[0]!;
    const before = server.cue.playbook().lines.find((l) => l.id === card.lineId)!;
    await turn(id, { speaker: 'rep', text: card.say });
    await post(server, `/api/calls/${id}/end`, { outcome: 'meeting_booked' });
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked' });
    await server.cue.idle();
    const pb = server.cue.playbook();
    const after = pb.lines.find((l) => l.id === card.lineId)!;
    expect(after.stats['*']!.shown).toBe(before.stats['*']!.shown + 1);
    expect(after.stats['*']!.booked).toBe(before.stats['*']!.booked + 1);
    const mined = pb.lines.find((l) => l.origin === 'rep');
    expect(mined?.status).toBe('active');
  });
});
