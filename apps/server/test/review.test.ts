import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { createCall, fakeMubit, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

async function playCall(s: CueServer): Promise<{ id: string; lineId: string }> {
  const id = await createCall(s);
  await post(s, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
  await s.cue.idle();
  const card = s.cue.getCall(id).current!;
  await post(s, `/api/calls/${id}/turns`, { speaker: 'rep', text: card.say });
  await post(s, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Okay, how much would that run us?' });
  await s.cue.idle();
  return { id, lineId: card.lineId };
}

describe('post-call review', () => {
  it('is idempotent: re-review replaces the call’s contribution instead of adding to it', async () => {
    server = testServer();
    const { id, lineId } = await playCall(server);
    const base = structuredClone(server.cue.s.playbook.get(lineId)!.stats['*']);
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked', rating: 4 });
    await server.cue.idle();
    const once = structuredClone(server.cue.s.playbook.get(lineId)!.stats['*']);
    expect(once!.shown).toBe((base?.shown ?? 0) + 1);
    const candidatesOnce = server.cue.s.playbook.all().filter((l) => l.status === 'candidate').length;

    // Feedback again and an explicit re-queue: same numbers.
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked', rating: 5 });
    await server.cue.reviews.queue(id);
    await server.cue.idle();
    expect(server.cue.s.playbook.get(lineId)!.stats['*']).toEqual(once);
    expect(server.cue.s.playbook.all().filter((l) => l.status === 'candidate').length).toBe(candidatesOnce);
    expect(server.cue.s.store.list(id).filter((e) => e.type === 'review.completed').length).toBeGreaterThanOrEqual(2);
  });

  it('a later, more trusted outcome re-reviews and moves booked → lost', async () => {
    server = testServer();
    const { id, lineId } = await playCall(server);
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked' });
    await server.cue.idle();
    const booked = server.cue.s.playbook.get(lineId)!.stats['*']!;
    server.cue.recordOutcome(id, { outcome: 'not_interested', source: 'trellus', raw: { disposition: 'Not interested' }, at: Date.now() });
    await server.cue.idle();
    const after = server.cue.s.playbook.get(lineId)!.stats['*']!;
    expect(after.shown).toBe(booked.shown);
    expect(after.booked).toBe(booked.booked - 1);
    expect(after.lost).toBe(booked.lost + 1);
    expect(server.cue.getCall(id).review?.outcome).toBe('not_interested');
  });

  it('candidate lines are policy-checked; a violating one is rejected, not queued for approval', async () => {
    server = testServer({
      mubit: fakeMubit({
        outputs: {
          review_call: (input) => ({
            summary: 's',
            outcome: 'meeting_booked',
            lines_used: [],
            candidate_lines: [{ moment: 'buying_signal', persona: 'ceo', receptivity: 'warm', text: 'Our policy will pay out on that kind of lawsuit, easily.', turn_id: input.record.transcript[0]?.id ?? null, rationale: 'r' }],
            missed_moments: [],
            what_worked: [],
            what_didnt: [],
            customer_attitude: 'friendly',
            coaching: [],
            suggestion_impact: 0.2,
          }),
          check_claim: (i) =>
            i.claim.includes('pay out')
              ? { verdict: 'violation', rule: 'Never promise a claim will be paid before underwriting.', rephrase: null, confidence: 0.9 }
              : { verdict: 'supported', rule: '', rephrase: null, confidence: 0.9 },
        },
      }),
    });
    const { id } = await playCall(server);
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked' });
    await server.cue.idle();
    const mined = server.cue.s.playbook.all().filter((l) => l.minedFrom?.callId === id);
    expect(mined).toHaveLength(1);
    expect(mined[0]!.status).toBe('rejected');
    expect(mined[0]!.policy?.verdict).toBe('violation');
    const updated = server.cue.s.store.list(id).find((e) => e.type === 'playbook.updated');
    expect(updated?.type === 'playbook.updated' && updated.candidatesAdded).toEqual([]);
  });

  it('falls back to a labelled rules review when review_call fails', async () => {
    server = testServer({ mubit: fakeMubit({ fail: { review_call: 'http' } }) });
    const { id } = await playCall(server);
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'follow_up', betterLine: 'Who re-shops your cover after a raise?' });
    await server.cue.idle();
    const ev = server.cue.s.store.list(id).find((e) => e.type === 'review.completed');
    expect(ev?.type === 'review.completed' && ev.servedBy).toBe('rules');
    const view = server.cue.getCall(id);
    expect(view.review?.linesUsed[0]?.used).toBe(true);
    expect(view.review?.candidateLines[0]?.text).toContain('re-shops');
  });

  it('auto-reviews ended calls with an outcome after the delay', async () => {
    server = testServer({ config: { autoReviewAfterMs: 0 } });
    const { id } = await playCall(server);
    await post(server, `/api/calls/${id}/end`, { outcome: 'voicemail' });
    server.cue.reviews.sweep();
    await server.cue.idle();
    expect(server.cue.getCall(id).status).toBe('reviewed');
  });
});
