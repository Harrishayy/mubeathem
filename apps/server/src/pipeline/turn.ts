import { MOMENT_META, endpointGuess, type Moment, sameUtterance, type CallEventInput, type CallView, type Evidence, type ReadMomentInput, type Situation, type Suggestion, type Turn, type UpNext, type WriteLineInput } from '@cue/core';
import { applyIdentity, computeFeatures, findRiskyClaims, newId, rankLines, rulesReadMoment, toSituation, upNextFor, type RankedLine } from '../adapters/core';
import type { ModelResult } from '../services/models';
import { clip, clipTail, type Services } from '../services/context';
import { lateCardAllowed, StandbyCache, standbyMoments, swapDecision, type StandbyLine } from './latency';

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
  /** Started on an interim that looked finished (endpointing), before the final. */
  early?: boolean;
  /** ms from the trigger to the instant card, and what served it. */
  instantMs?: number | null;
  instant?: 'rules' | 'cache' | null;
  /** What happened to the Mubit version: swapped in, or why the instant card was kept. */
  refine?: string;
}

interface Run {
  callId: string;
  turnId: string;
  /** The utterance text this run works on (an interim when `early`). */
  text: string;
  controller: AbortController;
  /** A card-flow terminal (shown / skipped) has been emitted for this utterance. */
  done: boolean;
  promise: Promise<void>;
  early: boolean;
  /** Early run with the Mubit stages held back until the final (CUE_EARLY_MUBIT=0). */
  instantOnly: boolean;
  /** When the transcript that started this run arrived. */
  receivedAt: number;
  /** The card on screen for this utterance (its latest version). */
  card: Suggestion | null;
  /** The bandit draw behind a rules instant card, so the refinement tailors the same line. */
  instantRanked: RankedLine[] | null;
  /** First rep speech (interim or final) after this prospect turn. */
  repSpokeAt: number | null;
  /** When the final transcript arrived (null while running on an interim). The refine window counts from here. */
  finalAt: number | null;
  /** The rules read's moment for `text`: a growing interim with the same moment keeps this run (and its Mubit calls). */
  rulesMoment: Moment | null;
}

interface InterimState {
  turnId: string;
  text: string;
  changedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A written line, from write_line now or from a standby written earlier. */
type Draft =
  | { ok: true; line: StandbyLine; risky: string | null; latencyMs: number; source: 'write' | 'standby' }
  | { ok: false; failure: Extract<ModelResult<'write_line'>, { ok: false }> | null; latencyMs: number };

interface DraftCtx {
  callId: string;
  view: CallView;
  turns: Turn[];
  index: number;
}

/**
 * architecture.md §5.1 + §5.3, per final prospect turn. Layers, fastest first:
 *  1. instant card: rules read + bandit line (or a standby line Mubit wrote ahead), emitted before any
 *     model call returns — on the final, or earlier on an interim that looks finished (endpointing);
 *  2. Mubit read_moment + write_line refine it, re-emitted with the same id, only when the swap policy
 *     allows (before the rep speaks or acts, within the window);
 *  3. standby: after the card, Mubit pre-writes lines for the predicted next moments.
 * One run per call at a time: a newer turn aborts the one in flight. Every stage has a budget and a
 * rules fallback; nothing throws out of `handle`.
 */
export class TurnPipeline {
  private runs = new Map<string, Run>();
  /** The latest run per call, kept after it finishes so a final can adopt an early run's card. */
  private last = new Map<string, Run>();
  private interims = new Map<string, InterimState>();
  private timings: StageTimings[] = [];
  readonly standby = new StandbyCache();

  constructor(private s: Services) {}

  /** Starts (or adopts the early run for) a final prospect turn. The promise settles when the turn is done. */
  handle(callId: string, turnId: string, receivedAt = this.s.now()): Promise<void> {
    this.clearInterim(callId, turnId);
    const turn = this.s.store.view(callId)?.turns.find((t) => t.id === turnId && t.final);
    const prev = this.runs.get(callId) ?? this.last.get(callId);
    if (prev && prev.turnId === turnId && turn) {
      // The final says what the interim said (or the same moment): the early run already did the work.
      if (!prev.instantOnly && (sameUtterance(prev.text, turn.text) || this.rulesMomentFor(callId, turnId, turn.text) === prev.rulesMoment)) {
        prev.finalAt = receivedAt;
        return prev.promise;
      }
      return this.start(callId, turnId, turn.text, receivedAt, false, prev);
    }
    return this.start(callId, turnId, turn?.text ?? '', receivedAt, false, null);
  }

  /**
   * An interim prospect transcript. Warms the Mubit connection on a new utterance and, when the
   * partial looks finished (endpointGuess), starts the turn before the final arrives.
   */
  interim(callId: string, turnId: string, text: string): void {
    const L = this.s.config.latency;
    let st = this.interims.get(callId);
    const fresh = !st || st.turnId !== turnId;
    if (fresh && L.warm && this.s.models.configured) this.s.models.warm();
    if (!L.earlyTrigger) return;
    if (fresh) {
      if (st?.timer) clearTimeout(st.timer);
      st = { turnId, text: '', changedAt: this.s.now(), timer: null };
      this.interims.set(callId, st);
    }
    if (st!.text !== text) {
      st!.text = text;
      st!.changedAt = this.s.now();
    }
    this.evaluate(callId, st!);
  }

  /** The rep started talking: cards on screen are locked from here on. */
  repSpeech(callId: string): void {
    const run = this.last.get(callId);
    if (run && run.repSpokeAt === null) run.repSpokeAt = this.s.now();
  }

  private evaluate(callId: string, st: InterimState): void {
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
    const g = endpointGuess(st.text, this.s.now() - st.changedAt, { pauseMs: this.s.config.latency.endpointPauseMs });
    if (g.complete) return this.trigger(callId, st.turnId, st.text);
    if (g.recheckInMs === null) return;
    st.timer = setTimeout(() => {
      st.timer = null;
      if (this.interims.get(callId) === st) this.evaluate(callId, st);
    }, g.recheckInMs);
    st.timer.unref?.();
  }

  private trigger(callId: string, turnId: string, text: string): void {
    const run = this.runs.get(callId) ?? this.last.get(callId);
    if (run && run.turnId === turnId && sameUtterance(run.text, text)) return;
    const view = this.s.store.view(callId);
    if (!view || view.status !== 'live') return;
    if (view.turns.some((t) => t.id === turnId && t.final)) return; // the final owns it now
    // The sentence grew but means the same thing: keep the run and its Mubit calls (no restart, no
    // aborted requests). Only a change of moment restarts it.
    if (run && run.turnId === turnId && !run.instantOnly && run.rulesMoment !== null && this.rulesMomentFor(callId, turnId, text) === run.rulesMoment) return;
    void this.start(callId, turnId, text, this.s.now(), true, run && run.turnId === turnId ? run : null);
  }

  /** The turn list a run works on: finals, plus this turn with `text` while it is still an interim. */
  private turnsFor(view: CallView, turnId: string, text: string): { turns: Turn[]; index: number } | null {
    const finals = view.turns.filter((x) => x.final || x.id === turnId);
    const index = finals.findIndex((x) => x.id === turnId);
    if (index < 0) return null;
    const turns = finals.slice();
    if (!turns[index]!.final && text) turns[index] = { ...turns[index]!, text };
    return { turns, index };
  }

  private rulesMomentFor(callId: string, turnId: string, text: string): Moment | null {
    try {
      const view = this.s.store.view(callId);
      const t = view && this.turnsFor(view, turnId, text);
      if (!view || !t) return null;
      const turns = t.turns.slice();
      turns[t.index] = { ...turns[t.index]!, text };
      return applyIdentity(toSituation(rulesReadMoment(readInputFor(view, turns, t.index))), text, view.prospect).moment;
    } catch {
      return null;
    }
  }

  private clearInterim(callId: string, turnId?: string): void {
    const st = this.interims.get(callId);
    if (!st || (turnId && st.turnId !== turnId)) return;
    if (st.timer) clearTimeout(st.timer);
    this.interims.delete(callId);
  }

  private start(callId: string, turnId: string, text: string, receivedAt: number, early: boolean, carry: Run | null): Promise<void> {
    const prev = this.runs.get(callId);
    if (prev && prev === carry) {
      // Same utterance, new text: hand the card on, no "superseded" (nothing was lost).
      this.runs.delete(callId);
      prev.done = true;
      prev.controller.abort('restarted');
    } else {
      this.supersede(callId, 'superseded');
    }
    const run: Run = {
      callId,
      turnId,
      text,
      controller: new AbortController(),
      done: !!carry?.card,
      promise: Promise.resolve(),
      early,
      instantOnly: early && !this.s.config.latency.earlyMubit,
      receivedAt: carry?.card ? carry.receivedAt : receivedAt,
      card: carry?.card ?? null,
      instantRanked: carry?.instantRanked ?? null,
      repSpokeAt: carry?.repSpokeAt ?? null,
      finalAt: early ? null : receivedAt,
      rulesMoment: null,
    };
    this.runs.set(callId, run);
    this.last.set(callId, run);
    run.promise = this.process(run, !!carry)
      .catch((e: unknown) => this.fail(run, 'pipeline', e))
      .finally(() => {
        if (this.runs.get(callId) === run) this.runs.delete(callId);
      });
    return run.promise;
  }

  /** Cancels the in-flight run for a call (newer turn, call ended) and explains the silence. */
  supersede(callId: string, reason: string): void {
    if (reason === 'call ended') {
      this.clearInterim(callId);
      this.standby.clear(callId);
      this.last.delete(callId);
    }
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

  /** Resolves when the call (or every call) has no turn or standby write in flight. */
  async idle(callId?: string): Promise<void> {
    for (;;) {
      const pending = callId ? [this.runs.get(callId)].filter(Boolean) : [...this.runs.values()];
      const standby = callId ? [] : this.standby.pending();
      if (!pending.length && !standby.length) return;
      await Promise.all([...pending.map((r) => r!.promise), ...standby]);
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

  private writeInputFor(c: DraftCtx, sit: Situation, ranked: RankedLine[], over: { lastProspectTurn?: string; alreadySaid?: string[] } = {}): WriteLineInput {
    const { view, turns, index } = c;
    return {
      situation: { persona: sit.persona, receptivity: sit.receptivity, moment: sit.moment, signals: sit.signals },
      lastProspectTurn: clipTail(over.lastProspectTurn ?? turns[index]!.text, WINDOW_TURN_CHARS),
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
      rep: { name: view.rep.name, company: this.s.config.seller.company },
      alreadySaid: (over.alreadySaid ?? view.history.map((h) => h.suggestion.say)).slice(-5),
    };
  }

  /** write_line → a Draft. Never throws. */
  private async draft(c: DraftCtx, sit: Situation, ranked: RankedLine[], signal: AbortSignal, over: { lastProspectTurn?: string; alreadySaid?: string[] } = {}): Promise<Draft> {
    const r = await this.s.models.run('write_line', this.writeInputFor(c, sit, ranked, over), { callId: c.callId, signal, budgetMs: this.s.config.budgets.writeMs });
    if (!r.ok) return { ok: false, failure: r, latencyMs: r.latencyMs };
    if (!r.output.say.trim()) return { ok: false, failure: { ok: false, code: 'bad_output', message: 'empty line', retryable: false, requestId: r.requestId, latencyMs: r.latencyMs, aborted: false }, latencyMs: r.latencyMs };
    // line_id must be a candidate; "none" (or anything unknown) maps to the bandit's top line.
    const chosen = ranked.find((x) => x.line.id === r.output.line_id) ?? ranked[0]!;
    let upNext: UpNext[] = r.output.up_next.slice(0, 3).map((u) => ({ ifTheySay: clip(u.if_they_say, 120), move: clip(u.move, 160), moment: u.moment }));
    if (!upNext.length) upNext = upNextFor(sit.moment).slice(0, 3);
    return {
      ok: true,
      line: { say: clip(r.output.say, 320), why: clip(r.output.why || chosen.evidence.text, 200), upNext, chosen, requestId: r.requestId },
      risky: r.output.risky_claim,
      latencyMs: r.latencyMs,
      source: 'write',
    };
  }

  private async process(run: Run, restarted: boolean): Promise<void> {
    const { s } = this;
    const L = s.config.latency;
    const { callId, turnId } = run;
    const signal = run.controller.signal;
    const live = () => !signal.aborted;
    const emit = (input: CallEventInput) => (live() ? s.store.append(input) : null);
    const skip = (reason: string) => {
      if (!live() || run.done) return;
      run.done = true;
      emit({ type: 'suggestion.skipped', callId, turnId, reason });
    };
    const t: StageTimings = { callId, turnId, readMs: null, writeMs: null, checkMs: null, totalMs: 0, read: null, write: null, outcome: 'skipped', requestIds: [], early: run.early, instantMs: null, instant: null };
    const finish = (outcome: StageTimings['outcome']) => {
      t.outcome = outcome;
      t.totalMs = s.now() - run.receivedAt;
      this.record(t);
    };

    const view = s.store.view(callId);
    if (!view || view.status !== 'live') return skip('call not live');
    const tf = this.turnsFor(view, turnId, run.text);
    if (!tf) return skip('turn not found');
    const { turns, index } = tf;
    run.text = turns[index]!.text;
    const c: DraftCtx = { callId, view, turns, index };
    const prospectTurns = turns.filter((x) => x.speaker === 'prospect').length;

    /* 1. features, the rules read (instant) and, with Mubit, the model read (in flight) */
    const input = readInputFor(view, turns, index);
    const features = input.features;
    const turnText = turns[index]!.text;
    const rulesSituation = applyIdentity(toSituation(rulesReadMoment(input)), turnText, view.prospect);
    run.rulesMoment = rulesSituation.moment;
    const speaks = (sit: Situation) => MOMENT_META[sit.moment].suggests && sit.shouldSuggest;
    const rank = (sit: Situation) => rankLines(s.playbook.active(), sit, { k: 3, rng: s.rng, exploreSlot: true });
    const configured = s.models.configured;
    const readPromise = configured && !run.instantOnly ? s.models.run('read_moment', input, { callId, signal, budgetMs: s.config.budgets.readMs }) : null;
    const acted = (id: string) => (s.store.view(callId)?.history.find((h) => h.suggestion.id === id)?.action ?? null) !== null;

    /* rules only (no key): one read, one card, as fast as the code runs */
    if (!configured) {
      if (restarted && run.card && run.card.situation.moment === rulesSituation.moment) return finish('shown');
      emit({ type: 'situation.read', callId, turnId, situation: rulesSituation, features, latencyMs: 0, servedBy: 'rules' });
      t.read = 'rules';
      if (!speaks(rulesSituation)) {
        if (run.card) return finish('shown');
        return finish('skipped'), skip(MOMENT_META[rulesSituation.moment].suggests ? 'quiet: no card needed' : `quiet: ${rulesSituation.moment}`);
      }
      const ranked = rank(rulesSituation);
      if (!ranked.length) return finish('skipped'), skip(`no playbook lines for ${rulesSituation.moment}`);
      const top = ranked[0]!;
      const card = this.cardFrom(run, rulesSituation, { say: top.line.text, why: `Top playbook line for ${MOMENT_META[rulesSituation.moment].label}`, upNext: upNextFor(rulesSituation.moment).slice(0, 3), chosen: top, requestId: null }, 'rules', { id: run.card?.id });
      t.write = 'rules';
      t.instantMs = s.now() - run.receivedAt;
      t.instant = 'rules';
      run.done = true;
      if (!emit({ type: 'suggestion.shown', callId, suggestion: card })) return;
      run.card = card;
      return finish('shown');
    }

    /* 2. the instant card: a standby line Mubit wrote ahead for this moment, else the bandit's top line */
    const showInstant = (sit: Situation, id?: string): Suggestion | null => {
      const cached = this.standby.takeReady(callId, sit.moment, sit.persona, prospectTurns, s.now());
      let card: Suggestion;
      if (cached) {
        card = { ...this.cardFrom(run, sit, cached, 'cache', { id }), stage: 'instant', precomputed: 'standby' };
        run.instantRanked = null;
        t.instant = 'cache';
      } else {
        const ranked = run.instantRanked && run.instantRanked[0]?.line.moment === sit.moment ? run.instantRanked : rank(sit);
        if (!ranked.length) return null;
        const top = ranked[0]!;
        card = { ...this.cardFrom(run, sit, { say: top.line.text, why: `Top playbook line for ${MOMENT_META[sit.moment].label}`, upNext: upNextFor(sit.moment).slice(0, 3), chosen: top, requestId: null }, 'rules', { id }), stage: 'instant' };
        run.instantRanked = ranked;
        t.instant = 'rules';
      }
      if (!emit({ type: 'suggestion.shown', callId, suggestion: card })) return null;
      if (cached?.requestId) s.telemetry.link(cached.requestId, callId, 'write_line', card.id);
      t.instantMs = s.now() - run.receivedAt;
      run.done = true;
      run.card = card;
      return card;
    };
    if (L.instant && speaks(rulesSituation) && (!run.card || run.card.situation.moment !== rulesSituation.moment)) showInstant(rulesSituation, run.card?.id);
    if (run.instantOnly) return finish(run.card ? 'shown' : 'skipped');

    /* 3. speculative write on the best guess, in parallel with read_moment (or the standby already writing it) */
    let spec: { moment: Situation['moment']; ranked: RankedLine[]; controller: AbortController; promise: Promise<Draft> } | null = null;
    const card0 = run.card;
    // Guess: the card on screen, the rules read when it speaks, else the previous read's moment
    // (calls tend to stay in an objection or buying loop for a turn or two).
    const guess: Situation | null = card0
      ? card0.situation
      : speaks(rulesSituation)
        ? rulesSituation
        : view.situation && MOMENT_META[view.situation.moment].suggests
          ? { ...rulesSituation, persona: view.situation.persona, receptivity: view.situation.receptivity, moment: view.situation.moment, shouldSuggest: true }
          : null;
    if (guess && card0?.servedBy !== 'cache') {
      const pending = this.standby.takePending(callId, guess.moment, guess.persona, prospectTurns, s.now());
      if (pending) {
        signal.addEventListener('abort', () => pending.controller.abort('superseded'), { once: true });
        spec = {
          moment: guess.moment,
          ranked: pending.ranked,
          controller: pending.controller,
          promise: pending.promise.then((line): Draft => (line ? { ok: true, line, risky: null, latencyMs: 0, source: 'standby' } : { ok: false, failure: null, latencyMs: 0 })),
        };
      } else {
        const ranked = run.instantRanked && run.instantRanked[0]?.line.moment === guess.moment ? run.instantRanked : rank(guess);
        if (ranked.length) {
          // Not tied to the run's signal: a draft that can't be swapped in is kept as a standby line.
          const controller = new AbortController();
          signal.addEventListener('abort', () => spec?.controller === controller && !recycled && controller.abort('superseded'), { once: true });
          spec = { moment: guess.moment, ranked, controller, promise: this.draft(c, guess, ranked, controller.signal) };
        }
      }
    }
    let recycled = false;
    const dropSpec = () => {
      if (!recycled) spec?.controller.abort('moment changed');
    };
    const safeLine = (d: Draft): StandbyLine | null => (d.ok && !d.risky && findRiskyClaims(d.line.say).length === 0 ? d.line : null);
    // The tailored line arrived too late for this card (the rep is talking): keep it for the next
    // time this moment comes up instead of throwing the write away.
    const recycle = (moment: Situation['moment'], persona: Situation['persona'], line?: StandbyLine): void => {
      if (!L.standby) return;
      if (line) {
        this.standby.put(callId, { moment, persona, turnCount: prospectTurns, createdAt: s.now(), ranked: [line.chosen], controller: new AbortController(), promise: Promise.resolve(line), ready: null, settled: false });
        return;
      }
      if (!spec || spec.moment !== moment || recycled) return;
      recycled = true;
      this.standby.put(callId, { moment, persona, turnCount: prospectTurns, createdAt: s.now(), ranked: spec.ranked, controller: spec.controller, promise: spec.promise.then(safeLine), ready: null, settled: false });
    };

    const read = await readPromise!;
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

    /* 4. decide whether to speak */
    const meta = MOMENT_META[situation.moment];
    if (!meta.suggests || !situation.shouldSuggest) {
      dropSpec();
      if (run.card) {
        t.refine = 'kept: model read is quiet';
        return finish('shown'), this.prepareStandby(run, c, prospectTurns);
      }
      finish('skipped');
      return skip(meta.suggests ? 'quiet: no card needed' : `quiet: ${situation.moment}`);
    }

    /* 5. may the card on screen still change? (cheap check before paying for another write) */
    const card = run.card;
    const ctx = () => ({ now: s.now(), repSpokeAt: run.repSpokeAt, acted: card ? acted(card.id) : false, windowMs: L.refineWindowMs });
    // The refine window counts from the final (end of speech); until it arrives the prospect is still talking.
    const shownCard = card ? { moment: card.situation.moment, confidence: card.situation.momentConfidence, say: card.say, servedBy: card.servedBy, get shownAt() { return run.finalAt ?? s.now(); } } : null;
    if (card) {
      const pre = swapDecision(shownCard!, { moment: situation.moment, confidence: situation.momentConfidence, say: '\u0000', servedBy: 'mubit' }, ctx());
      if (!pre.swap || (card.servedBy === 'cache' && card.situation.moment === situation.moment)) {
        if (!pre.swap) recycle(situation.moment, situation.persona);
        dropSpec();
        t.refine = pre.swap ? 'kept: standby line confirmed' : `kept: ${pre.reason}`;
        return finish('shown'), this.prepareStandby(run, c, prospectTurns);
      }
    } else if (L.instant && !lateCardAllowed(ctx())) {
      dropSpec();
      finish('skipped');
      return skip('late: rep already replying');
    }

    /* 6. the line: standby for the model's moment, the speculative draft when it matches, else write now */
    let ranked: RankedLine[];
    let draft: Draft;
    let servedBy: Suggestion['servedBy'] = 'mubit';
    const standbyLine = card?.situation.moment === situation.moment ? null : this.standby.takeReady(callId, situation.moment, situation.persona, prospectTurns, s.now());
    if (standbyLine) {
      dropSpec();
      t.path = 'speculative';
      ranked = [standbyLine.chosen];
      draft = { ok: true, line: standbyLine, risky: null, latencyMs: 0, source: 'standby' };
      servedBy = 'cache';
    } else if (spec && spec.moment === situation.moment) {
      t.path = 'speculative';
      ranked = spec.ranked;
      draft = await spec.promise;
    } else {
      t.path = spec ? 'rewritten' : 'direct';
      dropSpec();
      ranked = run.instantRanked && run.instantRanked[0]?.line.moment === situation.moment ? run.instantRanked : rank(situation);
      if (!ranked.length) {
        if (card) return finish('shown');
        return finish('skipped'), skip(`no playbook lines for ${situation.moment}`);
      }
      draft = await this.draft(c, situation, ranked, signal);
    }
    if (!live()) return;
    t.writeMs = draft.latencyMs;

    let line: StandbyLine;
    let writeBy: 'mubit' | 'rules';
    if (draft.ok) {
      line = draft.line;
      writeBy = 'mubit';
      if (draft.source === 'standby') servedBy = 'cache';
      if (line.requestId) t.requestIds.push(line.requestId);
    } else {
      if (draft.failure) this.noteFallback(callId, 'write_line', draft.failure);
      if (card) {
        t.write = 'rules';
        t.refine = 'kept: write failed';
        return finish('shown'), this.prepareStandby(run, c, prospectTurns);
      }
      writeBy = 'rules';
      servedBy = 'rules';
      const top = ranked[0]!;
      line = { say: top.line.text, why: `Top playbook line for ${meta.label}`, upNext: upNextFor(situation.moment).slice(0, 3), chosen: top, requestId: null };
    }
    t.write = writeBy;

    /* 7. policy check before anyone sees it (standby lines were screened when written) */
    const preHits = draft.ok && draft.source === 'write' ? findRiskyClaims(line.say) : [];
    let checkId: string | null = null;
    if (draft.ok && draft.source === 'write' && (draft.risky || preHits.length)) {
      const c0 = s.now();
      const check = await s.policy.check(line.say, 'rep', { callId, signal });
      if (!live()) return;
      t.checkMs = s.now() - c0;
      checkId = check.requestId;
      if (checkId) t.requestIds.push(checkId);
      const blocked = check.verdict === 'violation' || (check.verdict !== 'supported' && preHits.length > 0);
      if (blocked) {
        const safe = ranked.find((r) => findRiskyClaims(r.line.text).length === 0);
        if (!safe) {
          if (card) return (t.refine = 'kept: tailored line failed policy'), finish('shown');
          return finish('skipped'), skip('policy: no safe line');
        }
        line = { ...line, say: safe.line.text, why: 'Safe playbook line: the tailored one failed the policy check', chosen: safe };
      }
    }

    /* 8. show it: a new card, or the same card id refined in place when the policy allows */
    const now = s.now();
    let next = this.cardFrom(run, situation, line, servedBy, { id: card?.id, requestIds: t.requestIds, writePath: t.path ?? 'direct' });
    if (L.instant) next = { ...next, stage: 'refined', refinedAt: now, refinedLatencyMs: Math.max(0, Math.round(now - run.receivedAt)), ...(servedBy === 'cache' ? { precomputed: 'standby' as const } : {}) };
    if (card) {
      const d = swapDecision(shownCard!, { moment: next.situation.moment, confidence: situation.momentConfidence, say: next.say, servedBy: next.servedBy }, ctx());
      // Same words: re-emit anyway so the card says who wrote it and which requests are behind it.
      if (!d.swap && d.reason !== 'same_text') {
        t.refine = `kept: ${d.reason}`;
        if (draft.ok && servedBy === 'mubit' && line.say === draft.line.say && !checkId) recycle(situation.moment, situation.persona, line);
        return finish('shown'), this.prepareStandby(run, c, prospectTurns);
      }
      t.refine = d.swap ? `swapped: ${d.reason}` : 'relabelled: same text';
      next = { ...next, createdAt: card.createdAt, latencyMs: card.latencyMs };
    } else if (L.instant && !lateCardAllowed(ctx())) {
      finish('skipped');
      return skip('late: rep already replying');
    }
    run.done = true;
    if (!emit({ type: 'suggestion.shown', callId, suggestion: next })) return;
    run.card = next;
    if (draft.ok && line.requestId) s.telemetry.link(line.requestId, callId, 'write_line', next.id);
    s.telemetry.link(checkId, callId, 'check_claim', next.id);
    finish('shown');
    this.prepareStandby(run, c, prospectTurns);
  }

  private cardFrom(run: Run, situation: Situation, line: StandbyLine, servedBy: Suggestion['servedBy'], o: { id?: string | undefined; requestIds?: string[]; writePath?: Suggestion['writePath'] } = {}): Suggestion {
    const now = this.s.now();
    const ids = o.requestIds ?? (line.requestId ? [line.requestId] : []);
    return {
      id: o.id ?? newId('sug'),
      callId: run.callId,
      turnId: run.turnId,
      situation,
      say: clip(line.say, 320),
      why: clip(line.why, 200),
      lineId: line.chosen.line.id,
      evidence: clampEvidence(line.chosen.evidence),
      upNext: line.upNext.slice(0, 3),
      kind: 'line',
      createdAt: now,
      latencyMs: Math.max(0, Math.round(now - run.receivedAt)),
      servedBy,
      mubitRequestIds: ids.slice(0, 6),
      ...(o.writePath ? { writePath: o.writePath } : {}),
    };
  }

  /**
   * Standby: while the rep answers, have Mubit write lines for the moments the card predicts (and the
   * one we're in), so the next matching prospect turn gets a tailored card instantly.
   */
  private prepareStandby(run: Run, c: DraftCtx, prospectTurns: number): void {
    const { s } = this;
    const n = s.config.latency.standby;
    const card = run.card;
    if (!n || !card || !s.models.configured || run.controller.signal.aborted) return;
    try {
      const sit = card.situation;
      const moments = standbyMoments(sit.moment, card.upNext, n, (m) => MOMENT_META[m].suggests);
      const now = s.now();
      this.standby.prune(c.callId, prospectTurns, now, (e) => e.persona === sit.persona && moments.includes(e.moment));
      const said = [...c.view.history.map((h) => h.suggestion.say), card.say];
      for (const moment of moments) {
        if (this.standby.has(c.callId, moment, sit.persona, prospectTurns, now)) continue;
        const msit: Situation = { ...sit, moment, shouldSuggest: true };
        const ranked = rankLines(s.playbook.active(), msit, { k: 3, rng: s.rng, exploreSlot: true }).filter((r) => !said.includes(r.line.text));
        if (!ranked.length) continue;
        const hint = moment === sit.moment ? c.turns[c.index]!.text : (card.upNext.find((u) => u.moment === moment)?.ifTheySay ?? MOMENT_META[moment].label);
        const controller = new AbortController();
        const promise = this.draft(c, msit, ranked, controller.signal, { lastProspectTurn: hint, alreadySaid: said }).then((d) =>
          d.ok && !d.risky && findRiskyClaims(d.line.say).length === 0 ? d.line : null,
        );
        this.standby.put(c.callId, { moment, persona: sit.persona, turnCount: prospectTurns, createdAt: now, ranked, controller, promise, ready: null, settled: false });
      }
    } catch (e) {
      s.log.warn('standby failed', { message: e instanceof Error ? e.message : String(e) });
    }
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
