/**
 * Tops up the check_claim task with realistic rep claims, so it reaches Mubit's adapter threshold
 * alongside the other tasks. Simulated calls rarely produce risky claims, so the main seed can't.
 *
 *   tsx --env-file=../../.env scripts/seed-claims.ts [--dry]
 *
 * Standalone: these calls bypass the server's telemetry. Prefer `pnpm seed:mubit`, which tops up
 * check_claim through the server. Each claim is its own session (`seed_claim_<n>`). Cheap model only (CUE_MODEL_FAST).
 */
import { CORGI_POLICY } from '@cue/core';
import { createMubit } from '../src/client';
import { loadMubitConfig } from '../src/config';
import { isMubitError } from '../src/errors';
import { PRE_QUOTE_EVIDENCE, SEED_CLAIMS } from '../src/seed-claims';

const config = loadMubitConfig();
if (process.argv.includes('--dry')) {
  console.log(`[seed-claims] ${SEED_CLAIMS.length} check_claim calls on ${config.models.fast}, est. < $0.01`);
  process.exit(0);
}
if (!config.configured) {
  console.error('[seed-claims] MUBIT_API_KEY is not set.');
  process.exit(1);
}

const mubit = createMubit(config);
let ok = 0;
const verdicts: Record<string, number> = {};
await Promise.all(
  SEED_CLAIMS.map(async ([claim, extra], i) => {
    try {
      const r = await mubit.run('check_claim', { claim, speaker: 'rep', policy: CORGI_POLICY, evidence: [...PRE_QUOTE_EVIDENCE, ...extra] }, { sessionId: `seed_claim_${String(i + 1).padStart(2, '0')}` });
      ok++;
      verdicts[r.output.verdict] = (verdicts[r.output.verdict] ?? 0) + 1;
      console.log(`${r.output.verdict.padEnd(26)} ${String(r.latencyMs).padStart(5)} ms  ${claim}`);
    } catch (err) {
      console.log(`FAILED ${isMubitError(err) ? err.code : String(err)}  ${claim}`);
    }
  }),
);
const s = mubit.stats().find((t) => t.task === 'check_claim');
console.log(`\n[seed-claims] ${ok}/${SEED_CLAIMS.length} ok · ${JSON.stringify(verdicts)} · $${(s?.costUsd ?? 0).toFixed(4)} · last ${s?.lastRequestId ?? '-'}`);
