import { MOMENT_META, type CallEventInput, type CallView, type Evidence, type ReadMomentInput, type Situation, type Suggestion, type Turn, type UpNext, type WriteLineInput } from '@cue/core';
import { applyIdentity, computeFeatures, findRiskyClaims, newId, rankLines, rulesReadMoment, toSituation, upNextFor, type RankedLine } from '../adapters/core';
import { clip, clipTail, type Services } from '../services/context';

/** How much transcript `read_moment` sees: the last ~30 s, at most 8 turns, each turn's tail. */
const WINDOW_TURNS = 8;
const WINDOW_MS = 30_000;
const WINDOW_TURN_CHARS = 600;

export interface StageTimings {
  callId: string;
  turnId: string;
  readMs: number | null;
  writeMs: number | null;
  checkMs: number | null;
  totalMs: number;
  read: 'mubit' | 'rules' | null;
  write: 'mubit' | 'rules' | null;
  outcome: 'shown' | 'skipped' | 'superseded' | 'error';
  /** How the line was written: kept the speculative draft, rewrote after the model read, or wrote once. */
  path?: 'speculative' | 'rewritten' | 'direct';
  requestIds: string[];
}

interface Run {
  callId: string;
  turnId: string;
  controller: AbortController;
  /** A card-flow terminal (shown / skipped) has been emitted for this turn. */
  done: boolean;
  promise: Promise<void>;
}

/**
 * architecture.md §5.1, per final prospect turn. One run per call at a time: a newer turn aborts the
 * one in flight, which is closed with `suggestion.skipped: superseded`. Every stage has a budget and
 * a rules fallback; nothing throws out of `handle`.
 */
export class TurnPipeline {
  private runs = new Map<string, Run>();
  private timings: StageTimings[] = [];

  constructor(private s: Services) {}

  /** Starts the pipeline for a final prospect turn. The promise settles when the turn is done. */
  handle(callId: string, turnId: string, receivedAt = this.s.now()): Promise<void> {
    this.supersede(callId, 'superseded');
    const run: Run = { callId, turnId, controller: new AbortController(), done: false, promise: Promise.resolve() };
    this.runs.set(callId, run);
    run.promise = this.process(run, receivedAt)
      .catch((e: unknown) => this.fail(run, 'pipeline', e))
      .finally(() => {
        if (this.runs.get(callId) === run) this.runs.delete(callId);
      });
    return run.promise;
  }

  /** Cancels the in-flight run for a call (newer turn, call ended) and explains the silence. */
  supersede(callId: string, reason: string): void {
    const prev = this.runs.get(callId);
    if (!prev) return;
    this.runs.delete(callId);
    prev.controller.abort(reason);
    if (!prev.done) {
      prev.done = true;
      this.safeAppend({ type: 'suggestion.skipped', callId, turnId: prev.turnId, reason });
      this.record({ callId, turnId: prev.turnId, readMs: null, writeMs: null, checkMs: null, totalMs: 0, read: null, write: null, outcome: 'superseded', requestIds: [] });
    }
  }

  /** Resolves when the call (or every call) has no turn in flight. */
  async idle(callId?: string): Promise<void> {
    for (;;) {
      const pending = callId ? [this.runs.get(callId)].filter(Boolean) : [...this.runs.values()];
      if (!pending.length) return;
      await Promise.all(pending.map((r) => r!.promise));
    }
  }

  /** Recent per-stage timings, newest last (debug drawer, live test, seed). */
  recentTimings(callId?: string): StageTimings[] {
    return callId ? this.timings.filter((t) => t.callId === callId) : [...this.timings];
  }

  private record(t: StageTimings): void {
    this.timings.push(t);
    if (this.timings.length > 500) this.timings.splice(0, this.timings.length - 500);
  }

  private safeAppend(input: CallEventInput): void {
    try {
      this.s.store.append(input);
    } catch (e) {
      this.s.log.error('append failed', { type: input.type, message: e instanceof Error ? e.message : String(e) });
    }
  }

  private fail(run: Run, stage: string, e: unknown): void {
    if (run.controller.signal.aborted) return;
    const message = clip(e instanceof Error ? e.message : String(e), 480);
    this.s.log.error('pipeline failed', { callId: run.callId, stage, message });
    this.safeAppend({ type: 'pipeline.error', callId: run.callId, stage, message, retryable: true });
    if (!run.done) {
      run.done = true;
      this.safeAppend({ type: 'suggestion.skipped', callId: run.callId, turnId: run.turnId, reason: 'error' });
    }
  }

  private async process(run: Run, receivedAt: number): Promise<void> {
    const { s } = this;
    const { callId, turnId } = run;
    const signal = run.controller.signal;
    const live = () => !signal.aborted;
    const emit = (input: CallEventInput) => (live() ? s.store.append(input) : null);
    const skip = (reason: string) => {
      if (!live() || run.done) return;
      run.done = true;
      emit({ type: 'suggestion.skipped', callId, turnId, reason });
    };
    const t: StageTimings = { callId, turnId, readMs: null, writeMs: null, checkMs: null, totalMs: 0, read: null, write: null, outcome: 'skipped', requestIds: [] };
    const finish = (outcome: StageTimings['outcome']) => {
      t.outcome = outcome;
      t.totalMs = s.now() - receivedAt;
      this.record(t);
    };

    const view = s.store.view(callId);
    if (!view || view.status !== 'live') return skip('call not live');
    const turns = view.turns.filter((x) => x.final);
    const index = turns.findIndex((x) => x.id === turnId);
    if (index < 0) return skip('turn not found');

    /* 1. features, then the rules read (instant) and the model read (in flight) */
    const input = readInputFor(view, turns, index);
    const features = input.features;
    const turnText = turns[index]!.text;
    const rulesSituation = applyIdentity(toSituation(rulesReadMoment(input)), turnText, view.prospect);
    const readPromise = s.models.run('read_moment', input, { callId, signal, budgetMs: s.config.budgets.readMs });

    const writeInputFor = (sit: Situation, ranked: RankedLine[]): WriteLineInput => ({
      situation: { persona: sit.persona, receptivity: sit.receptivity, moment: sit.moment, signals: sit.signals },
      lastProspectTurn: clipTail(turns[index]!.text, WINDOW_TURN_CHARS),
      window: turns.slice(Math.max(0, index - 5), index + 1).map((x) => ({ speaker: x.speaker, text: clipTail(x.text, 300) })),
      candidates: ranked.map((r) => ({
        line_id: r.line.id,
        text: r.line.text,
        style: r.line.style,
        shown: r.stats.shown,
        used: r.stats.used,
        step_wins: r.stats.stepWins,
        booked: r.stats.booked,
        sampled_win_rate: round3(r.sampledWinRate),
      })),
      hooks: (view.brief?.hooks ?? []).map((h) => ({ hook: h.hook, product: h.product })),
      prospect: { name: view.prospect.name, title: view.prospect.title, company: view.prospect.company },
      rep: { name: view.rep.name, company: s.config.seller.company },
      alreadySaid: view.history.slice(-5).map((h) => h.suggestion.say),
    });
    const speaks = (sit: Situation) => MOMENT_META[sit.moment].suggests && sit.shouldSuggest;
    const rank = (sit: Situation) => rankLines(s.playbook.active(), sit, { k: 3, rng: s.rng, exploreSlot: true });

    /* 2. speculative write_line on the rules read, in parallel with read_moment (lead: 2026-10-24) */
    let spec: { ranked: RankedLine[]; controller: AbortController; promise: ReturnType<typeof s.models.run<'write_line'>>; startedAt: number } | null = null;
    // Guess the moment: the rules read when it is confident enough to speak, else the previous read
    // (calls tend to stay in an objection or buying loop for a turn or two).
    const guess: Situation | null = speaks(rulesSituation)
      ? rulesSituation
      : view.situation && MOMENT_META[view.situation.moment].suggests
        ? { ...rulesSituation, persona: view.situation.persona, receptivity: view.situation.receptivity, moment: view.situation.moment, shouldSuggest: true }
        : null;
    if (guess && s.models.configured) {
      const ranked = rank(guess);
      if (ranked.length) {
        const controller = new AbortController();
        const sig = AbortSignal.any([signal, controller.signal]);
        spec = { ranked, controller, startedAt: s.now(), promise: s.models.run('write_line', writeInputFor(guess, ranked), { callId, signal: sig, budgetMs: s.config.budgets.writeMs }) };
      }
    }
    const dropSpec = () => spec?.controller.abort('moment changed');

    const read = await readPromise;
    if (!live()) return dropSpec();
    t.readMs = read.latencyMs;
    let situation: Situation;
    let readBy: 'mubit' | 'rules';
    if (read.ok) {
      situation = applyIdentity(toSituation(read.output), turnText, view.prospect);
      readBy = 'mubit';
      if (read.requestId) t.requestIds.push(read.requestId);
    } else {
      situation = rulesSituation;
      readBy = 'rules';
      this.noteFallback(callId, 'read_moment', read);
    }
    t.read = readBy;
    emit({
      type: 'situation.read',
      callId,
      turnId,
      situation,
      features,
      latencyMs: Math.round(read.latencyMs),
      servedBy: readBy,
      ...(read.ok && read.requestId ? { mubitRequestId: read.requestId } : {}),
    });
    if (read.ok) s.telemetry.link(read.requestId, callId, 'read_moment');

    /* 3. decide whether to speak */
    const meta = MOMENT_META[situation.moment];
    if (!meta.suggests) return dropSpec(), finish('skipped'), skip(`quiet: ${situation.moment}`);
    if (!situation.shouldSuggest) return dropSpec(), finish('skipped'), skip('quiet: no card needed');

    /* 4. keep the speculative line when the moment matches; otherwise bandit + write again */
    let ranked: RankedLine[];
    let write: Awaited<ReturnType<typeof s.models.run<'write_line'>>>;
    if (spec && spec.ranked[0]!.line.moment === situation.moment) {
      t.path = 'speculative';
      ranked = spec.ranked;
      write = await spec.promise;
    } else {
      t.path = spec ? 'rewritten' : 'direct';
      dropSpec();
      ranked = rank(situation);
      if (!ranked.length) return finish('skipped'), skip(`no playbook lines for ${situation.moment}`);
      write = await s.models.run('write_line', writeInputFor(situation, ranked), { callId, signal, budgetMs: s.config.budgets.writeMs });
    }
    if (!live()) return;
    t.writeMs = write.latencyMs;

    let chosen: RankedLine = ranked[0]!;
    let say: string;
    let why: string;
    let upNext: UpNext[];
    let writeBy: 'mubit' | 'rules';
    let riskyHint: string | null = null;
    if (write.ok && write.output.say.trim()) {
      writeBy = 'mubit';
      // line_id must be a candidate; "none" (or anything unknown) maps to the bandit's top line.
      chosen = ranked.find((r) => r.line.id === write.output.line_id) ?? ranked[0]!;
      say = clip(write.output.say, 320);
      why = clip(write.output.why || chosen.evidence.text, 200);
      upNext = write.output.up_next.slice(0, 3).map((u) => ({ ifTheySay: clip(u.if_they_say, 120), move: clip(u.move, 160), moment: u.moment }));
      if (!upNext.length) upNext = upNextFor(situation.moment).slice(0, 3);
      riskyHint = write.output.risky_claim;
      if (write.requestId) t.requestIds.push(write.requestId);
    } else {
      writeBy = 'rules';
      say = clip(chosen.line.text, 320);
      why = clip(`Top playbook line for ${meta.label}`, 200);
      upNext = upNextFor(situation.moment).slice(0, 3);
      if (write.ok) this.noteFallback(callId, 'write_line', { ok: false, code: 'bad_output', message: 'empty line', retryable: false, aborted: false });
      else this.noteFallback(callId, 'write_line', write);
    }
    t.write = writeBy;

    /* 5. policy check before anyone sees it */
    const preHits = findRiskyClaims(say);
    let checkId: string | null = null;
    if (riskyHint || preHits.length) {
      const c0 = s.now();
      const check = await s.policy.check(say, 'rep', { callId, signal });
      if (!live()) return;
      t.checkMs = s.now() - c0;
      checkId = check.requestId;
      if (checkId) t.requestIds.push(checkId);
      const blocked = check.verdict === 'violation' || (check.verdict !== 'supported' && preHits.length > 0);
      if (blocked) {
        const safe = ranked.find((r) => findRiskyClaims(r.line.text).length === 0);
        if (!safe) return finish('skipped'), skip('policy: no safe line');
        chosen = safe;
        say = clip(safe.line.text, 320);
        why = clip('Safe playbook line: the tailored one failed the policy check', 200);
      }
    }

    /* 6. the card */
    const suggestion: Suggestion = {
      id: newId('sug'),
      callId,
      turnId,
      situation,
      say,
      why,
      lineId: chosen.line.id,
      evidence: clampEvidence(chosen.evidence),
      upNext,
      kind: 'line',
      createdAt: s.now(),
      latencyMs: Math.max(0, Math.round(s.now() - receivedAt)),
      servedBy: writeBy,
      mubitRequestIds: t.requestIds.slice(0, 6),
      writePath: t.path ?? 'direct',
    };
    run.done = true;
    if (!emit({ type: 'suggestion.shown', callId, suggestion })) return;
    if (write.ok) s.telemetry.link(write.requestId, callId, 'write_line', suggestion.id);
    s.telemetry.link(checkId, callId, 'check_claim', suggestion.id);
    finish('shown');
  }

  /** A stage fell back to rules: say so in the log, once per failure (not for a missing key). */
  private noteFallback(callId: string, stage: string, r: { ok: false; code: string; message: string; retryable: boolean; aborted: boolean }): void {
    if (r.aborted || r.code === 'not_configured') return;
    this.safeAppend({ type: 'pipeline.error', callId, stage, message: clip(`${r.code}: ${r.message}; served by rules`, 480), retryable: r.retryable });
  }
}

/** The `read_moment` input for final turn `index`: CRM, windowed transcript, features, previous read. */
export function readInputFor(view: Pick<CallView, 'prospect' | 'startedAt' | 'situation'>, turns: Turn[], index: number, previous: Situation | null = view.situation): ReadMomentInput {
  return {
    crm: { title: view.prospect.title, company: view.prospect.company, facts: view.prospect.facts },
    window: windowFor(turns, index).map((x) => ({ speaker: x.speaker, text: clipTail(x.text, WINDOW_TURN_CHARS), tMs: x.tMs })),
    features: computeFeatures(turns, index, { callStartedAt: view.startedAt }),
    previous: previous ? { persona: previous.persona, receptivity: previous.receptivity, moment: previous.moment } : null,
  };
}

/** Last ~30 s of turns up to `index`, at most 8, always at least the current and previous turn. */
export function windowFor(turns: Turn[], index: number): Turn[] {
  const cur = turns[index]!;
  const from = Math.max(0, index - WINDOW_TURNS + 1);
  const slice = turns.slice(from, index + 1);
  const recent = slice.filter((x) => cur.tMs - x.tMs <= WINDOW_MS);
  return recent.length >= 2 ? recent : slice.slice(-2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clampEvidence(e: Evidence): Evidence {
  return { ...e, text: clip(e.text, 200) };
}
