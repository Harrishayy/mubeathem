import { TASK_OUTPUT, type TaskId } from '@cue/core';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createMubit, type TaskResult } from '../../src/client';
import { loadMubitConfig } from '../../src/config';
import { INPUTS, LABELLED_READS } from '../fixtures';

/**
 * Live Mubit tests. Opt-in (MUBIT_LIVE=1), cheap models only, 13 calls per run:
 * 8 labelled read_moment lines + one call of each other task.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // No .env: the key may already be in the environment, or the suite skips below.
}

const config = loadMubitConfig();
const live = process.env.MUBIT_LIVE === '1';
const reason = !live ? 'set MUBIT_LIVE=1 to run' : !config.configured ? 'MUBIT_API_KEY is not set' : '';
if (reason) console.info(`[mubit live] skipped: ${reason}`);

const sessionId = `call_livetest_${Date.now().toString(36)}`;
const client = createMubit({ ...config, timeoutMs: 45_000 });
const rows: Array<{ task: TaskId; case: string; ms: number; requestId: string | null; attempts: number; note: string }> = [];

function log<K extends TaskId>(task: K, label: string, r: TaskResult<K>, note = '') {
  rows.push({ task, case: label, ms: r.latencyMs, requestId: r.requestId, attempts: r.attempts, note });
}

function assertHealthy<K extends TaskId>(task: K, r: TaskResult<K>) {
  expect(TASK_OUTPUT[task].safeParse(r.output).success).toBe(true);
  expect(r.requestId).toMatch(/^mreq_/);
  expect(r.latencyMs).toBeGreaterThan(0);
}

describe.skipIf(Boolean(reason))('Mubit live', () => {
  afterAll(() => {
    if (rows.length === 0) return;
    console.info(`\n[mubit live] session ${sessionId}`);
    console.table(rows);
    const stats = client.stats().filter((s) => s.calls > 0);
    console.table(stats.map((s) => ({ task: s.task, model: s.model, calls: s.calls, ok: s.ok, p50Ms: s.p50Ms, p95Ms: s.p95Ms, tokensIn: s.inputTokens, tokensOut: s.outputTokens, costUsd: s.costUsd.toFixed(5) })));
  });

  it('read_moment: at least 6 of 8 labelled lines', { timeout: 120_000 }, async () => {
    const results = await Promise.all(LABELLED_READS.map((c) => client.run('read_moment', c.input, { sessionId })));
    let correct = 0;
    results.forEach((r, i) => {
      const c = LABELLED_READS[i]!;
      assertHealthy('read_moment', r);
      const momentOk = r.output.moment === c.expect;
      const recOk = !c.receptivity || c.receptivity.includes(r.output.receptivity);
      if (momentOk) correct += 1;
      log('read_moment', c.name, r, `${momentOk ? 'ok' : 'MISS'} ${r.output.persona}.${r.output.receptivity}.${r.output.moment}${recOk ? '' : ' (receptivity off)'} | ${r.output.rationale}`);
    });
    console.info(`[mubit live] read_moment accuracy ${correct}/${LABELLED_READS.length}`);
    expect(correct).toBeGreaterThanOrEqual(6);
    // The warm vs cold "what's this regarding?" pair must read differently.
    const warm = results[LABELLED_READS.findIndex((c) => c.name.startsWith('warm'))]!.output;
    const cold = results[LABELLED_READS.findIndex((c) => c.name.startsWith('cold'))]!.output;
    expect(warm.receptivity_score).toBeGreaterThan(cold.receptivity_score);
  });

  it('write_line: picks a candidate and stays within one breath', { timeout: 60_000 }, async () => {
    const r = await client.run('write_line', INPUTS.write_line, { sessionId });
    assertHealthy('write_line', r);
    const words = r.output.say.split(/\s+/).filter(Boolean).length;
    log('write_line', 'cold wtr', r, `${r.output.line_id} (${words} words): ${r.output.say}`);
    expect(INPUTS.write_line.candidates.map((c) => c.line_id)).toContain(r.output.line_id);
    expect(words).toBeLessThanOrEqual(30);
  });

  it('check_claim: flags "definitely covered" as a violation', { timeout: 60_000 }, async () => {
    const r = await client.run('check_claim', INPUTS.check_claim, { sessionId });
    assertHealthy('check_claim', r);
    log('check_claim', 'definitely covered', r, `${r.output.verdict} -> ${r.output.rephrase ?? ''}`);
    expect(r.output.verdict).toBe('violation');
  });

  it('research_brief: hooks from the findings', { timeout: 60_000 }, async () => {
    const r = await client.run('research_brief', INPUTS.research_brief, { sessionId });
    assertHealthy('research_brief', r);
    log('research_brief', 'Series A + hiring', r, `${r.output.persona_guess} | ${r.output.hooks.map((h) => h.product).join(',')} | ${r.output.opener}`);
    expect(r.output.hooks.length).toBeGreaterThan(0);
    expect(r.output.persona_guess).toBe('ceo');
  });

  it('review_call: judges every suggestion', { timeout: 90_000 }, async () => {
    const r = await client.run('review_call', INPUTS.review_call, { sessionId });
    assertHealthy('review_call', r);
    log('review_call', 'booked demo call', r, `${r.output.outcome} | ${r.output.lines_used.map((l) => `${l.suggestion_id}:${l.used ? 'used' : 'no'}/${l.similarity}/${l.step_win ? 'win' : '-'}`).join(' ')}`);
    expect(r.output.outcome).toBe('meeting_booked');
    expect(r.output.lines_used.map((l) => l.suggestion_id).sort()).toEqual(['sug_1', 'sug_2', 'sug_3']);
    expect(r.output.lines_used.find((l) => l.suggestion_id === 'sug_1')?.used).toBe(true);
  });

  it('simulate_prospect: stays in character', { timeout: 60_000 }, async () => {
    const r = await client.run('simulate_prospect', INPUTS.simulate_prospect, { sessionId });
    assertHealthy('simulate_prospect', r);
    log('simulate_prospect', 'cool CEO', r, `${r.output.intended_moment} ${r.output.mood_now}: ${r.output.reply}`);
    expect(r.output.reply.length).toBeGreaterThan(0);
    expect(r.output.books_meeting).toBe(false);
  });
});
