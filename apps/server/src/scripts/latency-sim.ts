/**
 * Live latency simulation: replays cold-call transcripts in real time through the real server
 * pipeline (in-process `boot()` with a temp db) and measures, per prospect turn, how long the rep
 * waits for a usable card after the prospect stops talking.
 *
 *   pnpm --filter @cue/server latency:sim [--mubit] [--label=x] [--scripts=demo,objections]
 *        [--final-delay=450] [--stt-lag=200] [--interim-ms=250] [--wps=2.6] [--rep-react=900]
 *        [--parallel] [--cap=0.25] [--set KEY=VALUE ...] [--no-write] [--verbose]
 *
 * Speech model: words come out at `wps` words/s. The transcriber sends an interim every
 * `interim-ms` with the words spoken up to `stt-lag` ms ago (Deepgram/Web Speech style), a last
 * full interim at end + stt-lag, then the final at end + `final-delay` (Deepgram endpointing=300
 * lands at ~450 ms; Web Speech is closer to 800–1000 ms). The rep starts replying `rep-react` ms
 * after the prospect stops, unless the script says otherwise.
 *
 * Without `--mubit` the key is removed from the environment (rules only). With it, cheap models
 * only, and the run stops itself once Mubit spend for the run passes `--cap` USD.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CallEvent, Moment } from '@cue/core';
import { boot, type CueServer } from '../boot';
import { SIM_SCRIPTS, type SimScript } from './latency-scripts';

interface Opts {
  mubit: boolean;
  label: string;
  scripts: string[];
  finalDelayMs: number;
  sttLagMs: number;
  interimMs: number;
  wps: number;
  repReactMs: number;
  prospectGapMs: number;
  parallel: boolean;
  /** Interims without punctuation (Web Speech); the final keeps it. */
  noPunct: boolean;
  /** A stand-in Mubit with the measured latency distribution (free; for tuning the flow). */
  fakeMubit: boolean;
  capUsd: number;
  set: Record<string, string>;
  write: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    mubit: false,
    label: '',
    scripts: SIM_SCRIPTS.map((s) => s.id),
    finalDelayMs: 450,
    sttLagMs: 200,
    interimMs: 250,
    wps: 2.6,
    repReactMs: 900,
    prospectGapMs: 600,
    parallel: false,
    noPunct: false,
    fakeMubit: false,
    capUsd: 0.25,
    set: {},
    write: true,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [k, v] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, ''];
    const num = (d: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);
    switch (k) {
      case '--mubit': o.mubit = true; break;
      case '--label': o.label = v; break;
      case '--scripts': o.scripts = v.split(',').filter(Boolean); break;
      case '--final-delay': o.finalDelayMs = num(o.finalDelayMs); break;
      case '--stt-lag': o.sttLagMs = num(o.sttLagMs); break;
      case '--interim-ms': o.interimMs = num(o.interimMs); break;
      case '--wps': o.wps = num(o.wps); break;
      case '--rep-react': o.repReactMs = num(o.repReactMs); break;
      case '--parallel': o.parallel = true; break;
      case '--no-punct': o.noPunct = true; break;
      case '--fake-mubit': o.fakeMubit = true; break;
      case '--cap': o.capUsd = num(o.capUsd); break;
      case '--no-write': o.write = false; break;
      case '--verbose': o.verbose = true; break;
      case '--set': {
        const kv = argv[++i] ?? '';
        const eq = kv.indexOf('=');
        if (eq > 0) o.set[kv.slice(0, eq)] = kv.slice(eq + 1);
        break;
      }
      default: if (a.startsWith('--')) console.warn(`unknown flag ${a}`);
    }
  }
  if (!o.label) o.label = o.mubit ? 'mubit' : o.fakeMubit ? 'fake' : 'rules';
  return o;
}

/* ───────── timeline ───────── */

interface Scheduled {
  t: number;
  kind: 'interim' | 'final';
  line: number;
  text: string;
}

interface LinePlan {
  index: number;
  speaker: 'rep' | 'prospect';
  text: string;
  expect?: Moment;
  start: number;
  end: number;
  finalAt: number;
  turnId: string;
}

function plan(script: SimScript, o: Opts, tag: string): { lines: LinePlan[]; events: Scheduled[] } {
  const lines: LinePlan[] = [];
  const events: Scheduled[] = [];
  let prevEnd = 0;
  const strip = (t: string) => (o.noPunct ? t.replace(/[.,!?;:…]/g, '').toLowerCase() : t);
  script.lines.forEach((l, i) => {
    const words = l.text.split(/\s+/).filter(Boolean);
    const dur = Math.max(450, Math.round((words.length / o.wps) * 1000));
    const gap = l.gapMs ?? (l.speaker === 'rep' ? o.repReactMs : o.prospectGapMs);
    const start = Math.max(0, prevEnd + gap);
    const end = start + dur;
    const finalAt = end + o.finalDelayMs;
    const turnId = `turn_${tag}_${String(i + 1).padStart(2, '0')}`;
    lines.push({ index: i, speaker: l.speaker, text: l.text, ...(l.expect ? { expect: l.expect } : {}), start, end, finalAt, turnId });
    let last = '';
    for (let tick = start + o.interimMs; tick < end + o.sttLagMs; tick += o.interimMs) {
      const spoken = Math.min(words.length, Math.floor(((tick - o.sttLagMs - start) / dur) * words.length));
      if (spoken < 1) continue;
      const text = strip(words.slice(0, spoken).join(' '));
      if (text === last) continue;
      last = text;
      events.push({ t: tick, kind: 'interim', line: i, text });
    }
    if (last !== strip(l.text) && end + o.sttLagMs < finalAt) events.push({ t: end + o.sttLagMs, kind: 'interim', line: i, text: strip(l.text) });
    events.push({ t: finalAt, kind: 'final', line: i, text: l.text });
    prevEnd = end;
  });
  events.sort((a, b) => a.t - b.t || (a.kind === 'final' ? 1 : -1));
  return { lines, events };
}

/* ───────── one call ───────── */

interface Show {
  at: number;
  id: string;
  say: string;
  moment: Moment;
  servedBy: string;
  stage?: string;
  writePath?: string;
}

export interface TurnResult {
  script: string;
  turn: number;
  text: string;
  expect: Moment | null;
  words: number;
  /** ms from end of speech to the first card (negative = shown before they finished). */
  firstMs: number | null;
  /** ms from the final transcript arriving to the first card. */
  firstFromFinalMs: number | null;
  /** ms from end of speech to the last version of the card. */
  finalMs: number | null;
  shows: number;
  /** The card's text changed after it was first shown (or it was replaced by another card). */
  flicker: boolean;
  /** The card changed after the prospect stopped talking (a change mid-utterance costs the rep less). */
  flickerAfterEnd: boolean;
  firstMoment: Moment | null;
  finalMoment: Moment | null;
  momentStable: boolean | null;
  firstServedBy: string | null;
  finalServedBy: string | null;
  finalStage: string | null;
  /** ms between the rep starting to talk and the last change to the card; > 0 = changed while they spoke. */
  changedAfterRepMs: number | null;
  readyBeforeRep: boolean | null;
  skipped: string | null;
  readServedBy: string | null;
  readMs: number | null;
}

async function sleepUntil(t: number): Promise<void> {
  const ms = t - performance.now();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function runScript(server: CueServer, script: SimScript, o: Opts, abort: { stop: boolean }): Promise<TurnResult[]> {
  const { cue } = server;
  const view = cue.createCall({ prospect: script.prospect, rep: script.rep, source: 'cue' } as Parameters<typeof cue.createCall>[0]);
  const callId = view.id;
  const tag = `${script.id}_${callId.slice(-6)}`;
  const { lines, events } = plan(script, o, tag);
  const shows = new Map<string, Show[]>();
  const skips = new Map<string, string>();
  const reads = new Map<string, { servedBy: string; at: number; latencyMs: number }>();
  const unsub = cue.s.store.subscribe(callId, (e: CallEvent) => {
    const at = performance.now();
    if (e.type === 'suggestion.shown' && e.suggestion.kind === 'line') {
      const s = e.suggestion as typeof e.suggestion & { stage?: string };
      const list = shows.get(s.turnId) ?? [];
      list.push({ at, id: s.id, say: s.say, moment: s.situation.moment, servedBy: s.servedBy, ...(s.stage ? { stage: s.stage } : {}), ...(s.writePath ? { writePath: s.writePath } : {}) });
      shows.set(s.turnId, list);
    } else if (e.type === 'suggestion.skipped') {
      skips.set(e.turnId, e.reason);
    } else if (e.type === 'situation.read') {
      reads.set(e.turnId, { servedBy: e.servedBy, at, latencyMs: e.latencyMs });
    }
  });

  // The rep reads the brief before dialling: wait for it (bounded) so it doesn't overlap the first turn.
  const briefBy = performance.now() + 15_000;
  while (!cue.getCall(callId).brief && performance.now() < briefBy) await new Promise((r) => setTimeout(r, 100));

  const t0 = performance.now() + 50;
  for (const ev of events) {
    if (abort.stop) break;
    await sleepUntil(t0 + ev.t);
    const l = lines[ev.line]!;
    try {
      cue.addTurn(callId, { id: l.turnId, speaker: l.speaker, text: ev.text, final: ev.kind === 'final', via: 'sim', tMs: Math.round(l.start) } as Parameters<typeof cue.addTurn>[1]);
    } catch (e) {
      if (o.verbose) console.warn('addTurn failed', e instanceof Error ? e.message : e);
    }
  }
  // Late refinements: give the in-flight turn time to land, then end the call.
  await Promise.race([cue.idle(), new Promise((r) => setTimeout(r, 8000))]);
  await new Promise((r) => setTimeout(r, 300));
  try {
    cue.endCall(callId, {} as Parameters<typeof cue.endCall>[1]);
  } catch {
    /* already ended */
  }
  unsub();

  const results: TurnResult[] = [];
  lines.forEach((l, i) => {
    if (l.speaker !== 'prospect') return;
    const list = shows.get(l.turnId) ?? [];
    const speechEnd = t0 + l.end;
    const finalAt = t0 + l.finalAt;
    const next = lines.slice(i + 1).find((x) => x.speaker === 'rep');
    const nextAny = lines[i + 1];
    // The rep starts talking at the next rep line, unless the prospect speaks again first.
    const repStart = next && (!nextAny || nextAny === next) ? t0 + next.start : null;
    const first = list[0];
    const last = list[list.length - 1];
    let lastChangeAt: number | null = null;
    let flicker = false;
    let flickerAfterEnd = false;
    for (let k = 1; k < list.length; k++) {
      if (list[k]!.say !== list[k - 1]!.say || list[k]!.id !== list[k - 1]!.id) {
        flicker = true;
        if (list[k]!.at >= speechEnd) flickerAfterEnd = true;
        lastChangeAt = list[k]!.at;
      }
    }
    const read = reads.get(l.turnId);
    results.push({
      script: script.id,
      turn: i + 1,
      text: l.text,
      expect: l.expect ?? null,
      words: l.text.split(/\s+/).filter(Boolean).length,
      firstMs: first ? Math.round(first.at - speechEnd) : null,
      firstFromFinalMs: first ? Math.round(first.at - finalAt) : null,
      finalMs: last ? Math.round(last.at - speechEnd) : null,
      shows: list.length,
      flicker,
      flickerAfterEnd,
      firstMoment: first?.moment ?? null,
      finalMoment: last?.moment ?? null,
      momentStable: first && last ? first.moment === last.moment : null,
      firstServedBy: first?.servedBy ?? null,
      finalServedBy: last?.servedBy ?? null,
      finalStage: last?.stage ?? null,
      changedAfterRepMs: repStart !== null && lastChangeAt !== null ? Math.round(lastChangeAt - repStart) : null,
      readyBeforeRep: repStart !== null && first ? first.at <= repStart : null,
      skipped: list.length ? null : (skips.get(l.turnId) ?? 'no card'),
      readServedBy: read?.servedBy ?? null,
      readMs: read ? Math.round(read.at - speechEnd) : null,
    });
  });
  return results;
}

/* ───────── stats ───────── */

function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export interface Summary {
  turns: number;
  cards: number;
  skipped: number;
  readyP50: number | null;
  readyP95: number | null;
  fromFinalP50: number | null;
  fromFinalP95: number | null;
  finalP50: number | null;
  finalP95: number | null;
  flickerRate: number;
  flickerAfterEndRate: number;
  momentStableRate: number;
  firstAccuracy: number | null;
  finalAccuracy: number | null;
  changedWhileRepSpoke: number;
  readyBeforeRepRate: number | null;
  servedBy: Record<string, number>;
  refined: number;
}

export function summarise(rs: TurnResult[]): Summary {
  const carded = rs.filter((r) => r.firstMs !== null);
  // Ready lag: a card shown before the prospect finished costs the rep nothing.
  const ready = carded.map((r) => Math.max(0, r.firstMs!));
  const labelled = rs.filter((r) => r.expect);
  const acc = (f: (r: TurnResult) => Moment | null) => (labelled.length ? labelled.filter((r) => f(r) === r.expect).length / labelled.length : null);
  const withRep = carded.filter((r) => r.readyBeforeRep !== null);
  const servedBy: Record<string, number> = {};
  for (const r of carded) servedBy[`${r.firstServedBy}→${r.finalServedBy}`] = (servedBy[`${r.firstServedBy}→${r.finalServedBy}`] ?? 0) + 1;
  return {
    turns: rs.length,
    cards: carded.length,
    skipped: rs.length - carded.length,
    readyP50: pct(ready, 50),
    readyP95: pct(ready, 95),
    fromFinalP50: pct(carded.map((r) => r.firstFromFinalMs!), 50),
    fromFinalP95: pct(carded.map((r) => r.firstFromFinalMs!), 95),
    finalP50: pct(carded.map((r) => Math.max(0, r.finalMs!)), 50),
    finalP95: pct(carded.map((r) => Math.max(0, r.finalMs!)), 95),
    flickerRate: carded.length ? carded.filter((r) => r.flicker).length / carded.length : 0,
    flickerAfterEndRate: carded.length ? carded.filter((r) => r.flickerAfterEnd).length / carded.length : 0,
    momentStableRate: carded.length ? carded.filter((r) => r.momentStable).length / carded.length : 0,
    firstAccuracy: acc((r) => r.firstMoment),
    finalAccuracy: acc((r) => r.finalMoment),
    changedWhileRepSpoke: carded.filter((r) => (r.changedAfterRepMs ?? -1) > 0).length,
    readyBeforeRepRate: withRep.length ? withRep.filter((r) => r.readyBeforeRep).length / withRep.length : null,
    servedBy,
    refined: carded.filter((r) => r.finalStage === 'refined').length,
  };
}

const f = (n: number | null, d = 0) => (n === null ? '–' : n.toFixed(d));
const pc = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);

function table(rs: TurnResult[]): string {
  const head = '| script | # | words | expect | first ms | from final | final ms | first → final moment | served | flicker | Δ after rep | skipped |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = rs.map(
    (r) =>
      `| ${r.script} | ${r.turn} | ${r.words} | ${r.expect ?? ''} | ${f(r.firstMs)} | ${f(r.firstFromFinalMs)} | ${f(r.finalMs)} | ${r.firstMoment ?? ''}${r.finalMoment && r.finalMoment !== r.firstMoment ? ` → ${r.finalMoment}` : ''} | ${r.firstServedBy ?? ''}${r.finalServedBy && r.finalServedBy !== r.firstServedBy ? `→${r.finalServedBy}` : ''} | ${r.flicker ? 'yes' : ''} | ${r.changedAfterRepMs !== null && r.changedAfterRepMs > 0 ? r.changedAfterRepMs : ''} | ${r.skipped ?? ''} |`,
  );
  return [head, sep, ...rows].join('\n');
}

export function summaryLine(label: string, s: Summary, cost: number): string {
  return `| ${label} | ${f(s.readyP50)} | ${f(s.readyP95)} | ${f(s.fromFinalP50)} | ${f(s.fromFinalP95)} | ${f(s.finalP50)} | ${f(s.finalP95)} | ${pc(s.flickerRate)} (${pc(s.flickerAfterEndRate)}) | ${pc(s.momentStableRate)} | ${pc(s.firstAccuracy)} / ${pc(s.finalAccuracy)} | ${s.changedWhileRepSpoke} | ${s.cards}/${s.turns} | $${cost.toFixed(4)} |`;
}

/* ───────── main ───────── */

async function makeFake() {
  const { fakeMubit, seeded } = await import('../../test/helpers');
  const { upNextFor } = await import('@cue/core');
  const rnd = seeded(7);
  const logNormal = (median: number, sigma: number) => {
    const u = Math.max(rnd(), 1e-9);
    const v = rnd();
    return Math.round(median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  };
  const medians: Record<string, number> = { read_moment: 1600, write_line: 1450, check_claim: 1050, research_brief: 1300 };
  return fakeMubit({
    delay: (task) => logNormal(medians[task] ?? 1200, 0.22),
    outputs: {
      write_line: (i) => ({
        say: `${i.candidates[0]?.text ?? 'Hello'} (tailored)`,
        why: 'fake: tailored top line',
        line_id: i.candidates[0]?.line_id ?? 'none',
        up_next: upNextFor(i.situation.moment).slice(0, 3).map((u) => ({ if_they_say: u.ifTheySay, move: u.move, moment: u.moment })),
        risky_claim: null,
      }),
    },
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const env: Record<string, string | undefined> = { ...process.env, ...o.set };
  if (!o.mubit) delete env.MUBIT_API_KEY;
  if (!o.mubit) delete env.MUBIT_API_KEY;
  if (o.mubit && !env.MUBIT_API_KEY) throw new Error('--mubit needs MUBIT_API_KEY in .env');
  // Cheap models only, whatever the environment says.
  env.CUE_MODEL_FAST = 'gpt-4o-mini';
  env.CUE_MODEL_WRITE = 'gpt-4.1-mini';
  delete env.EXA_API_KEY;
  delete env.SAPLING_URL;
  delete env.TRELLUS_API_KEY;
  const dir = mkdtempSync(join(tmpdir(), 'cue-latency-'));
  // Fake Mubit: latencies from the baseline run (read_moment ≈ 1650 ms, write_line ≈ 1480 ms,
  // log-normal spread), outputs from the rules engine with the wording marked as tailored.
  const fake = o.fakeMubit ? await makeFake() : null;
  const server = boot({
    env,
    ...(fake ? { mubit: fake, sent: fake.sent } : {}),
    config: { dbPath: join(dir, 'sim.db') },
    log: o.verbose ? undefined : { info() {}, warn() {}, error() {} },
  } as Parameters<typeof boot>[0]);
  const spend = () => (server.cue.s.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM mubit_calls').get() as { c: number }).c;
  const abort = { stop: false };
  const watchdog = setInterval(() => {
    if (spend() > o.capUsd) {
      abort.stop = true;
      console.error(`spend cap $${o.capUsd} exceeded, stopping`);
    }
  }, 500);

  const scripts = o.scripts.map((id) => SIM_SCRIPTS.find((s) => s.id === id)).filter((s): s is SimScript => !!s);
  console.log(`latency sim · ${o.label} · ${o.mubit ? 'Mubit' : o.fakeMubit ? 'fake Mubit' : 'rules only'} · ${scripts.length} scripts · final +${o.finalDelayMs} ms · stt lag ${o.sttLagMs} ms · interim ${o.interimMs} ms${o.noPunct ? ' (no punctuation)' : ''}`);
  if (o.mubit) await server.cue.s.models.ping();
  const results: TurnResult[] = [];
  if (o.parallel) {
    for (const r of await Promise.all(scripts.map((s) => runScript(server, s, o, abort)))) results.push(...r);
  } else {
    for (const s of scripts) {
      if (abort.stop) break;
      results.push(...(await runScript(server, s, o, abort)));
      console.log(`  ${s.id} done · spend $${spend().toFixed(4)}`);
    }
  }
  clearInterval(watchdog);
  const cost = spend();
  const byTask = server.cue.s.db.prepare("SELECT task, COUNT(*) AS n, SUM(ok) AS ok, SUM(error_code = 'aborted') AS aborted, ROUND(AVG(CASE WHEN ok = 1 THEN latency_ms END)) AS avgMs, SUM(cost_usd) AS cost FROM mubit_calls GROUP BY task").all();
  const traces = (() => {
    server.flushTraces();
    return (server.cue.s.db.prepare('SELECT COUNT(*) AS n FROM mubit_traces').get() as { n: number }).n;
  })();
  await server.close();
  rmSync(dir, { recursive: true, force: true });

  const s = summarise(results);
  console.log('\n' + table(results));
  console.log('\n| run | ready p50 | ready p95 | from-final p50 | from-final p95 | final card p50 | final card p95 | flicker (after end) | first=final moment | accuracy first / final | changed while rep spoke | cards | spend |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  console.log(summaryLine(o.label, s, cost));
  console.log('\nservedBy (first→final):', JSON.stringify(s.servedBy), '· refined:', s.refined, '· mubit by task:', JSON.stringify(byTask), '· traces:', traces);
  if (o.write) {
    const outDir = resolve(import.meta.dirname, '../../../../docs/perf');
    mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = join(outDir, `latency-${date}-${o.label}.json`);
    writeFileSync(file, JSON.stringify({ label: o.label, at: new Date().toISOString(), options: { ...o, set: o.set }, summary: s, spendUsd: cost, mubitByTask: byTask, traces, turns: results }, null, 2) + '\n');
    console.log(`wrote ${file}`);
  }
  if (abort.stop) process.exitCode = 2;
}

if (process.argv[1] && /latency-sim\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
