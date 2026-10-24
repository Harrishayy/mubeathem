/**
 * `pnpm seed [--calls 30] [--concurrency 3] [--from-trellus] [--dry] [--yes] [--db <path>] [--seed <n>]`
 *
 * Runs full practice calls (simulated prospect × a seeded matrix of personas, moods and objections)
 * through the real pipeline and review, so every Mubit task passes the 25-example adapter threshold.
 * `--from-trellus` instead imports recent Trellus sessions and runs read_moment + review_call over them.
 * Prints a cost estimate first and refuses anything over $1 without `--yes`.
 */
import { TASK_IDS, type TaskId } from '@cue/core';
import { practiceCall, type CallResult } from './practice-run';
import { boot, type CueServer } from '../boot';
import { expandPath } from '../config';
import { costUsd, TASKS, ADAPTER_THRESHOLD, SEED_CLAIMS, PRE_QUOTE_EVIDENCE } from '../adapters/mubit';
import { readInputFor } from '../pipeline/turn';
import { toSituation, rulesReadMoment, CORGI_POLICY } from '../adapters/core';
import { TASK_TIER } from '../services/models';
import { seededRng } from '@cue/core';

interface Args {
  calls: number;
  concurrency: number;
  fromTrellus: boolean;
  dry: boolean;
  yes: boolean;
  db: string | null;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { calls: 30, concurrency: 3, fromTrellus: false, dry: false, yes: false, db: null, seed: 7 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => argv[++i] ?? '';
    if (k === '--calls') { const n = Number(v()); a.calls = Number.isFinite(n) ? Math.max(0, Math.min(500, Math.floor(n))) : 30; }
    else if (k === '--concurrency') a.concurrency = Math.max(1, Math.min(8, Number(v()) || 3));
    else if (k === '--from-trellus') a.fromTrellus = true;
    else if (k === '--dry') a.dry = true;
    else if (k === '--yes' || k === '-y') a.yes = true;
    else if (k === '--db') a.db = v();
    else if (k === '--seed') a.seed = Number(v()) || 7;
    else if (k === '--help' || k === '-h') {
      console.log('pnpm seed [--calls 30] [--concurrency 3] [--from-trellus] [--dry] [--yes] [--db <path>] [--seed <n>]');
      process.exit(0);
    }
  }
  return a;
}

/* ───────── cost estimate ───────── */

/** Mubit calls per practice call, roughly (≤ 6 prospect turns). */
const PER_CALL: Record<TaskId, number> = { research_brief: 1, simulate_prospect: 6, read_moment: 6, write_line: 6, check_claim: 0.5, review_call: 1, live_cue: 0 };
/** Rough user-message tokens per task (the instructions are measured). */
const INPUT_TOKENS: Record<TaskId, number> = { research_brief: 500, simulate_prospect: 600, read_moment: 700, write_line: 1100, check_claim: 250, review_call: 5000, live_cue: 1500 };

function estimate(calls: number, models: { fast: string; write: string }, perCall: Partial<Record<TaskId, number>> = PER_CALL): { usd: number; mubitCalls: number } {
  let usd = 0;
  let n = 0;
  for (const t of TASK_IDS) {
    const k = (perCall[t] ?? 0) * calls;
    const def = TASKS[t];
    const input = Math.ceil(def.instructions.length / 4) + INPUT_TOKENS[t];
    usd += k * costUsd((models as Record<string, string>)[TASK_TIER[t]] ?? models.write, { input, output: Math.ceil(def.maxOutputTokens * 0.6) });
    n += k;
  }
  // 30% margin for speculative rewrites and retries.
  return { usd: usd * 1.3, mubitCalls: Math.ceil(n * 1.15) };
}

/* ───────── runs ───────── */

async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

/** Imported Trellus calls: read every prospect turn (situation.read) and review the whole call. */
async function importedCall(server: CueServer, callId: string): Promise<void> {
  const { cue } = server;
  const s = cue.s;
  const view = cue.getCall(callId);
  const turns = view.turns.filter((t) => t.final);
  let previous = null as ReturnType<typeof toSituation> | null;
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker !== 'prospect') continue;
    const input = readInputFor(view, turns, index, previous);
    const r = await s.models.run('read_moment', input, { callId, budgetMs: s.config.budgets.readMs * 4 });
    const situation = toSituation(r.ok ? r.output : rulesReadMoment(input));
    previous = situation;
    s.store.append({ type: 'situation.read', callId, turnId: turn.id, situation, features: input.features, latencyMs: Math.round(r.latencyMs), servedBy: r.ok ? 'mubit' : 'rules', ...(r.ok && r.requestId ? { mubitRequestId: r.requestId } : {}) });
  }
  await cue.reviews.queue(callId);
}

function table(server: CueServer, since: number): void {
  const total = server.cue.stats().tasks;
  const run = server.cue.s.db
    .prepare('SELECT task, COUNT(*) AS calls, SUM(ok) AS ok, COALESCE(SUM(cost_usd), 0) AS cost FROM mubit_calls WHERE at >= ? GROUP BY task')
    .all(since) as { task: string; calls: number; ok: number; cost: number }[];
  const pad = (x: unknown, n: number) => String(x).padEnd(n);
  console.log('\n' + [pad('task', 18), pad('run', 5), pad('ok', 5), pad('total', 6), pad('sessions', 9), pad('p50 ms', 7), pad('p95 ms', 7), pad('run $', 9), pad('adapter (25)', 13), 'last request id'].join(' '));
  for (const t of total) {
    const r = run.find((x) => x.task === t.task);
    console.log(
      [pad(t.task, 18), pad(r?.calls ?? 0, 5), pad(r?.ok ?? 0, 5), pad(t.calls, 6), pad(t.sessions, 9), pad(Math.round(t.p50Ms), 7), pad(Math.round(t.p95Ms), 7), pad((r?.cost ?? 0).toFixed(4), 9), pad(t.ok >= ADAPTER_THRESHOLD ? 'passed' : `${t.ok}/${ADAPTER_THRESHOLD}`, 13), t.lastRequestId ?? '—'].join(' '),
    );
  }
  const cost = run.reduce((n, r) => n + r.cost, 0);
  console.log(`\nthis run: ${run.reduce((n, r) => n + r.calls, 0)} Mubit calls, $${cost.toFixed(4)} at list price`);
}

/**
 * Simulated reps rarely overpromise, so check_claim lags behind the other tasks. Top it up with
 * realistic claims through the server's model service, so the calls land in its telemetry.
 */
async function topUpClaims(server: CueServer): Promise<void> {
  const { cue } = server;
  const have = cue.stats().tasks.find((t) => t.task === 'check_claim')?.ok ?? 0;
  if (have >= ADAPTER_THRESHOLD) return;
  const claims = SEED_CLAIMS.slice(0, Math.max(0, ADAPTER_THRESHOLD + 1 - have));
  console.log(`[seed] check_claim has ${have}; adding ${claims.length} rep claims`);
  await pool(claims.map((c, i) => ({ c, i })), 4, async ({ c: [claim, extra], i }) => {
    const r = await cue.s.models.run('check_claim', { claim, speaker: 'rep', policy: CORGI_POLICY, evidence: [...PRE_QUOTE_EVIDENCE, ...extra] }, { callId: `seed_claim_${Date.now().toString(36)}_${i}`, budgetMs: 15_000 });
    if (!r.ok) console.warn('[seed] claim failed:', claim);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const server = boot({ ...(args.db ? { config: { dbPath: expandPath(args.db) } } : {}), log: { info() {}, warn: (m, d) => console.warn('[seed]', m, d ?? ''), error: (m, d) => console.error('[seed]', m, d ?? '') } });
  const { cue } = server;
  const models = cue.s.models.models;
  try {
    if (!cue.s.models.configured && !args.dry) {
      console.error('[seed] MUBIT_API_KEY is not set: seeding would only exercise the rules engine and train nothing. Use --dry to see the plan.');
      process.exitCode = 1;
      return;
    }

    if (args.fromTrellus) {
      if (cue.trellus.kind !== 'trellus') {
        console.error('[seed] --from-trellus needs TRELLUS_API_KEY (env or POST /api/trellus/key).');
        process.exitCode = 1;
        return;
      }
      const est = estimate(args.calls, models, { read_moment: 6, review_call: 1 });
      console.log(`[seed] from Trellus: up to ${args.calls} sessions, ~${est.mubitCalls} Mubit calls, est. $${est.usd.toFixed(2)} (${models.fast} / ${models.write})`);
      if (args.dry) return;
      if (est.usd > 1 && !args.yes) return void (console.error('[seed] estimate over $1; re-run with --yes'), (process.exitCode = 1));
      const since = Date.now();
      const res = await cue.trellus.sync(30 * 24 * 3600_000, args.calls);
      console.log(`[seed] imported ${res.imported} (skipped ${res.skipped} already imported)`);
      await pool(res.importedIds, args.concurrency, (id) => importedCall(server, id));
      await cue.idle();
      table(server, since);
      return;
    }

    const est = estimate(args.calls, models);
    console.log(`[seed] ${args.calls} practice calls × concurrency ${args.concurrency}: ~${est.mubitCalls} Mubit calls, est. $${est.usd.toFixed(2)} at list price (${models.fast} / ${models.write}); db ${server.config.dbPath}`);
    if (args.dry) return;
    if (est.usd > 1 && !args.yes) {
      console.error('[seed] estimate over $1; re-run with --yes to go ahead');
      process.exitCode = 1;
      return;
    }
    const since = Date.now();
    const rng = seededRng(args.seed);
    const results: CallResult[] = [];
    await pool(
      Array.from({ length: args.calls }, (_, i) => i),
      args.concurrency,
      async (i) => {
        try {
          const r = await practiceCall(server, i, rng);
          results.push(r);
          console.log(`[seed] ${String(results.length).padStart(3)}/${args.calls} ${r.callId} ${r.scenario.padEnd(36)} turns ${r.turns} cards ${r.cards} used ${r.used} → ${r.outcome}`);
        } catch (e) {
          console.error(`[seed] call ${i} failed:`, e instanceof Error ? e.message : e);
        }
      },
    );
    await cue.idle();
    await topUpClaims(server);
    table(server, since);
    const lat = results.flatMap((r) => r.turnToCardMs).sort((a, b) => a - b);
    if (lat.length) console.log(`turn → card: p50 ${lat[Math.floor(lat.length / 2)]} ms, p95 ${lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)]} ms over ${lat.length} cards`);
  } finally {
    await server.close();
  }
}

void main();
