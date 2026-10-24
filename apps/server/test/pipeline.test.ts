import { CallEvent, rulesReadMoment, type ReadMomentOutput } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { createCall, fakeMubit, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

const shown = (s: CueServer, id: string) => s.cue.s.store.list(id).flatMap((e) => (e.type === 'suggestion.shown' ? [e.suggestion] : []));
const skipped = (s: CueServer, id: string) => s.cue.s.store.list(id).flatMap((e) => (e.type === 'suggestion.skipped' ? [e] : []));

describe('live turn pipeline', () => {
  it('5 prospect turns in 200 ms: only the last produces a card, the rest are skipped as superseded', async () => {
    const mubit = fakeMubit({ delayMs: { read_moment: 120, write_line: 80 } });
    server = testServer({ mubit });
    const id = await createCall(server);
    const texts = ['Hello?', 'Who is this?', "What's this regarding?", 'Hm.', "Sorry, what's this regarding?"];
    for (const text of texts) {
      await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text });
      await new Promise((r) => setTimeout(r, 40));
    }
    await server.cue.idle();
    const turnIds = server.cue.s.store.list(id).flatMap((e) => (e.type === 'turn.added' ? [e.turn.id] : []));
    const cards = shown(server, id);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.turnId).toBe(turnIds[4]);
    const sup = skipped(server, id).filter((e) => e.reason === 'superseded');
    expect(sup.map((e) => e.turnId)).toEqual(turnIds.slice(0, 4));
    expect(mubit.calls.filter((c) => c.aborted).length).toBeGreaterThan(0);
    expect(server.cue.getCall(id).pending).toBe(false);
  });

  it('Mubit timeout → rules card labelled servedBy rules, with a pipeline.error', async () => {
    server = testServer({ mubit: fakeMubit({ fail: { read_moment: 'hang', write_line: 'hang' } }), config: { budgets: { readMs: 60, writeMs: 60, checkMs: 60, briefMs: 60, reviewMs: 200, simMs: 60 } } });
    const id = await createCall(server);
    const t0 = Date.now();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "...what's this regarding?" });
    await server.cue.idle();
    expect(Date.now() - t0).toBeLessThan(1500);
    const [card] = shown(server, id);
    expect(card!.servedBy).toBe('rules');
    const events = server.cue.s.store.list(id);
    const read = events.find((e) => e.type === 'situation.read');
    expect(read?.type === 'situation.read' && read.servedBy).toBe('rules');
    expect(events.some((e) => e.type === 'pipeline.error' && e.stage === 'read_moment' && e.message.includes('timeout'))).toBe(true);
  });

  it('Mubit bad output → rules fallback, never a thrown request', async () => {
    server = testServer({ mubit: fakeMubit({ fail: { read_moment: 'bad_output', write_line: 'bad_output', research_brief: 'http' } }) });
    const id = await createCall(server);
    const res = await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    expect(res.status).toBe(202);
    await server.cue.idle();
    const [card] = shown(server, id);
    expect(card!.servedBy).toBe('rules');
    expect(card!.situation.moment).toBe('objection_broker');
    expect(server.cue.getCall(id).brief?.servedBy).toBe('rules');
  });

  it('no Mubit at all → rules everywhere, no pipeline.error noise', async () => {
    server = testServer({ mubit: null });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    expect(shown(server, id)[0]!.servedBy).toBe('rules');
    expect(server.cue.s.store.list(id).some((e) => e.type === 'pipeline.error')).toBe(false);
  });

  it('20 concurrent calls do not cross events', async () => {
    server = testServer({ mubit: fakeMubit({ delayMs: { read_moment: 15, write_line: 15 } }) });
    const ids = await Promise.all(Array.from({ length: 20 }, () => createCall(server)));
    await Promise.all(
      ids.map(async (id, i) => {
        await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: `What's this regarding? (call ${i})` });
        await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: `Quick one for call ${i}` });
      }),
    );
    await server.cue.idle();
    for (const [i, id] of ids.entries()) {
      const events = server.cue.s.store.list(id);
      expect(events.every((e) => e.callId === id)).toBe(true);
      expect(events.map((e) => e.seq)).toEqual(events.map((_, k) => k + 1));
      const turns = events.flatMap((e) => (e.type === 'turn.added' ? [e.turn.text] : []));
      expect(turns.every((t) => t.includes(`call ${i})`) || t.includes(`call ${i}`))).toBe(true);
      expect(shown(server, id)).toHaveLength(1);
      expect(shown(server, id)[0]!.callId).toBe(id);
    }
  });

  it('a 4000-char turn is windowed before it reaches read_moment', async () => {
    const mubit = fakeMubit();
    server = testServer({ mubit });
    const id = await createCall(server);
    const long = 'blah '.repeat(790) + "so what's this regarding?";
    expect(long.length).toBeLessThanOrEqual(4000);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: long });
    await server.cue.idle();
    const read = mubit.calls.find((c) => c.task === 'read_moment')!.input as { window: { text: string }[] };
    expect(Math.max(...read.window.map((w) => w.text.length))).toBeLessThanOrEqual(600);
    expect(read.window.at(-1)!.text).toContain("what's this regarding?");
    expect(shown(server, id)).toHaveLength(1);
  });

  it('unicode and emoji survive the store and the pipeline', async () => {
    server = testServer();
    const id = await createCall(server, { prospect: { name: 'Zoë Ørsted', title: 'CEO', company: 'Fjörd AI 🚀', facts: {} } });
    const text = '¿Qué? 你好 — what’s this regarding? 🙃';
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text });
    await server.cue.idle();
    const view = server.cue.getCall(id);
    expect(view.turns[0]!.text).toBe(text);
    expect(view.prospect.company).toBe('Fjörd AI 🚀');
    for (const e of server.cue.s.store.list(id)) CallEvent.parse(e);
  });

  it('rep claim "that\'d definitely be covered" → policy.checked violation + compliance card', async () => {
    server = testServer();
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: "Yeah, that'd definitely be covered." });
    await server.cue.idle();
    const view = server.cue.getCall(id);
    expect(view.flags).toHaveLength(1);
    expect(view.flags[0]!.verdict).toBe('violation');
    expect(view.flags[0]!.speaker).toBe('rep');
    expect(view.current?.kind).toBe('compliance');
    expect(view.current?.situation.moment).toBe('compliance');
    expect(view.current?.compliance?.rephrase.length).toBeGreaterThan(0);
  });

  it('rep saying the card marks it used automatically', async () => {
    server = testServer();
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const card = server.cue.getCall(id).current!;
    await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: card.say });
    await server.cue.idle();
    expect(server.cue.getCall(id).history[0]!.action).toBe('used');
  });

  it('a risky tailored line is swapped for a safe playbook line before it is shown', async () => {
    server = testServer({
      mubit: fakeMubit({
        outputs: {
          write_line: (i) => ({ say: "Honestly, you'd definitely be covered for that.", why: 'x', line_id: i.candidates[0]!.line_id, up_next: [], risky_claim: 'definitely be covered' }),
        },
      }),
    });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    const [card] = shown(server, id);
    expect(card!.say).not.toMatch(/definitely be covered/);
    expect(server.cue.s.playbook.get(card!.lineId)?.text).toBe(card!.say);
  });

  it('the writer flagging risky_claim alone triggers check_claim; a violation swaps the line', async () => {
    const mubit = fakeMubit({
      outputs: {
        write_line: (i) => ({ say: 'Our cover would handle that whole scenario for you.', why: 'x', line_id: i.candidates[0]!.line_id, up_next: [], risky_claim: 'cover would handle that' }),
        check_claim: () => ({ verdict: 'violation', rule: 'Never promise coverage before underwriting.', rephrase: null, confidence: 0.9 }),
      },
    });
    server = testServer({ mubit });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    const [card] = shown(server, id);
    expect(mubit.count('check_claim')).toBe(1);
    expect(card!.say).not.toContain('whole scenario');
    expect(card!.mubitRequestIds.length).toBe(3);
  });

  it('speculative write is kept when the model read agrees with the rules read', async () => {
    const mubit = fakeMubit({ delayMs: { read_moment: 100, write_line: 100 } });
    server = testServer({ mubit });
    const id = await createCall(server);
    const t0 = Date.now();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const [card] = shown(server, id);
    expect(card!.writePath).toBe('speculative');
    expect(Date.now() - t0).toBeLessThan(190); // parallel, not 200 ms sequential
    expect(mubit.count('write_line')).toBe(1);
  });

  it('speculative write is aborted and redone when the model reads a different moment', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 60, write_line: 100 },
      outputs: { read_moment: (i): ReadMomentOutput => ({ ...rulesReadMoment(i), moment: 'objection_broker', should_suggest: true }) },
    });
    server = testServer({ mubit });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const [card] = shown(server, id);
    expect(card!.writePath).toBe('rewritten');
    expect(card!.situation.moment).toBe('objection_broker');
    expect(server.cue.s.playbook.get(card!.lineId)?.moment).toBe('objection_broker');
    const writes = mubit.calls.filter((c) => c.task === 'write_line');
    expect(writes).toHaveLength(2);
    expect(writes[0]!.aborted).toBe(true);
    // The dropped draft was sent, so it is counted (ok=0, 'aborted'), but not as a failure.
    const rows = server.cue.s.db.prepare("SELECT ok, error_code AS e FROM mubit_calls WHERE task = 'write_line' ORDER BY id").all() as { ok: number; e: string | null }[];
    expect(rows).toEqual([{ ok: 0, e: 'aborted' }, { ok: 1, e: null }]);
    const st = server.cue.stats().tasks.find((t) => t.task === 'write_line')!;
    expect(st.calls).toBe(2);
    expect(st.failed).toBe(0);
  });

  it('when the rules read is quiet, it speculates on the previous moment', async () => {
    const mubit = fakeMubit({
      delayMs: { read_moment: 60, write_line: 60 },
      outputs: { read_moment: (i): ReadMomentOutput => ({ ...rulesReadMoment(i), moment: 'objection_broker', should_suggest: true }) },
    });
    server = testServer({ mubit });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Hm. They have been with us for years, honestly.' });
    await server.cue.idle();
    const cards = shown(server, id);
    expect(cards.map((c) => c.writePath)).toEqual(['speculative', 'speculative']);
    expect(mubit.count('write_line')).toBe(2);
  });

  it('write_line answering line_id "none" maps to the bandit top line', async () => {
    server = testServer({ mubit: fakeMubit({ outputs: { write_line: () => ({ say: 'Fair. When did they last re-quote you?', why: 'x', line_id: 'none', up_next: [], risky_claim: null }) } }) });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    const [card] = shown(server, id);
    const line = server.cue.s.playbook.get(card!.lineId);
    expect(line?.moment).toBe('objection_broker');
  });

  it('quiet moments are skipped with a reason', async () => {
    server = testServer();
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "Hi, you've reached Maya, please leave a message after the tone." });
    await server.cue.idle();
    expect(shown(server, id)).toHaveLength(0);
    expect(skipped(server, id)[0]!.reason).toMatch(/quiet/);
  });

  it('ending the call cancels the in-flight turn', async () => {
    server = testServer({ mubit: fakeMubit({ delayMs: { read_moment: 200 } }) });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await post(server, `/api/calls/${id}/end`, {});
    await server.cue.idle();
    expect(shown(server, id)).toHaveLength(0);
    expect(skipped(server, id)[0]!.reason).toBe('call ended');
  });
});
