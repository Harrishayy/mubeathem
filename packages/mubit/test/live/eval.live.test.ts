import type { Moment } from '@cue/core';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMubit } from '../../src/client';
import { loadMubitConfig } from '../../src/config';
import { EVAL_CASES } from '../eval-cases';

/**
 * read_moment eval over the demo script and edge lines (~26 calls on gpt-4o-mini).
 * EVAL_ONLY=substr,substr runs just the matching cases (for cheap re-checks while tuning).
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // No .env; the suite skips below if there is no key.
}

const config = loadMubitConfig();
const reason = process.env.MUBIT_LIVE !== '1' ? 'set MUBIT_LIVE=1 to run' : !config.configured ? 'MUBIT_API_KEY is not set' : '';
const only = (process.env.EVAL_ONLY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const cases = only.length ? EVAL_CASES.filter((c) => only.some((o) => c.name.toLowerCase().includes(o))) : EVAL_CASES;

describe.skipIf(Boolean(reason))('read_moment eval (live)', () => {
  it(`reads ${cases.length} labelled lines`, { timeout: 300_000 }, async () => {
    const client = createMubit({ ...config, timeoutMs: 45_000 });
    const sessionId = `call_eval_${Date.now().toString(36)}`;
    // Waves of `concurrency` calls, so latency is per call rather than time spent queueing.
    const results: Awaited<ReturnType<typeof client.run<'read_moment'>>>[] = [];
    for (let i = 0; i < cases.length; i += config.concurrency) {
      results.push(...(await Promise.all(cases.slice(i, i + config.concurrency).map((c) => client.run('read_moment', c.input, { sessionId })))));
    }

    const perMoment = new Map<Moment, { n: number; ok: number }>();
    let correct = 0;
    let buyingFalsePositives = 0;
    let suggestMisses = 0;
    const rows = results.map((r, i) => {
      const c = cases[i]!;
      const o = r.output;
      const ok = c.accept.includes(o.moment);
      if (ok) correct += 1;
      if (o.moment === 'buying_signal' && !c.accept.includes('buying_signal')) buyingFalsePositives += 1;
      const suggestOk = c.shouldSuggest === undefined || c.shouldSuggest === o.should_suggest;
      if (!suggestOk) suggestMisses += 1;
      const m = perMoment.get(c.accept[0]!) ?? { n: 0, ok: 0 };
      m.n += 1;
      if (ok) m.ok += 1;
      perMoment.set(c.accept[0]!, m);
      const flags = [ok ? '' : `MISS want ${c.accept.join('|')}`, c.persona && c.persona !== o.persona ? `persona want ${c.persona}` : '', c.receptivity && !c.receptivity.includes(o.receptivity) ? `rec want ${c.receptivity.join('|')}` : '', suggestOk ? '' : `should_suggest want ${c.shouldSuggest}`].filter(Boolean).join('; ');
      return { case: c.name, read: `${o.persona}.${o.receptivity}.${o.moment}${o.should_suggest ? '' : ' (quiet)'}`, ms: r.latencyMs, flags, requestId: r.requestId };
    });

    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    console.table(rows);
    console.table([...perMoment].map(([moment, m]) => ({ moment, correct: `${m.ok}/${m.n}` })));
    console.info(
      `[eval] accuracy ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(0)}%) · buying_signal false positives ${buyingFalsePositives} · should_suggest misses ${suggestMisses} · p50 ${latencies[Math.floor((latencies.length - 1) / 2)]} ms (concurrency ${config.concurrency})`,
    );

    for (const r of results) expect(r.requestId).toMatch(/^mreq_/);
    if (!only.length) {
      expect(correct / cases.length).toBeGreaterThanOrEqual(0.9);
      expect(buyingFalsePositives).toBe(0);
      expect(suggestMisses).toBe(0);
    }
  });
});
