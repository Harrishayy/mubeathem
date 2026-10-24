import {
  MOMENTS,
  MOMENT_META,
  PERSONAS,
  RECEPTIVITY,
  RECEPTIVITY_SCORE,
  endpointGuess,
  sameUtterance,
  situationKey,
  type CallEventInput,
  type CallView,
  type Evidence,
  type LiveCueInput,
  type LiveCueOutput,
  type Moment,
  type Persona,
  type Receptivity,
  type Situation,
  type Suggestion,
  type Turn,
  type UpNext,
} from '@cue/core';
import { computeFeatures, evidenceFor, findRiskyClaims, newId, rankLines } from '../adapters/core';
import { clip, clipTail, type Services } from '../services/context';

/** How much of the call live_cue sees: the whole call (capped for a runaway one), each turn's tail. */
const TRANSCRIPT_TURNS = 80;
const TURN_CHARS = 500;
/** Playbook lines per moment in the call's draw. */
const LINES_PER_MOMENT = 2;
/** The id a card carries when the model wrote a new line instead of tailoring a playbook one (no stats are kept for it). */
export const NEW_LINE_ID = 'line_none';

export interface LiveTimings {
  callId: string;
  turnId: string;
  /** Started on an interim that looked finished, before the final transcript. */
  early: boolean;
  /** The first card was a line pre-written for a predicted reply, matched on the prospect's first words. */
  predicted?: boolean;
  /** ms from the trigger to: the first finished field (the read), the line on screen, the full answer. */
  readMs: number | null;
  cardMs: number | null;
  doneMs: number | null;
  /** ms from the final transcript to the line on screen; negative when it was up before the final arrived. */
  fromFinalMs: number | null;
  outcome: 'shown' | 'quiet' | 'superseded' | 'error' | 'blocked';
  requestId: string | null;
}

interface LiveRun {
  callId: string;
  turnId: string;
  text: string;
  early: boolean;
  controller: AbortController;
  receivedAt: number;
  finalAt: number | null;
  /** The card on screen for this utterance (carried across a restart, so it updates in place). */
  card: Suggestion | null;
  /** A terminal event (shown / skipped) has been emitted for this utterance. */
  done: boolean;
  repSpokeAt: number | null;
  /** The model call is still running. */
  inFlight: boolean;
  /** Newer words for this turn that arrived while it ran: they run next, so the card it shows stays up. */
  pending: { text: string; receivedAt: number; early: boolean } | null;
  promise: Promise<void>;
  t: LiveTimings;
}

/** A line pre-written for one likely reply, while the rep was talking. */
interface Prediction {
  reply: string;
  out: LiveCueOutput | null;
  requestId: string | null;
}

/** The predictions for a call's next prospect turn, made after the last card. */
interface Predictions {
  items: Prediction[];
  /** The replies' embeddings, in order (null when embedding failed). */
  vecs: Promise<number[][] | null>;
  ready: Promise<void>;
  controller: AbortController;
  /** The prospect turn being matched, and the word count at the last attempt. */
  turnId: string | null;
  triedAtWords: number;
  attempts: number;
  matching: boolean;
}

interface InterimState {
  turnId: string;
  text: string;
  changedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const isOne = <T extends string>(list: readonly T[], v: string | undefined): v is T => !!v && (list as readonly string[]).includes(v);

/**
 * The live path with no rules read: every prospect turn is one streamed `live_cue` call through Mubit
 * that reads the moment and writes the line together. The card goes up the moment the line's text
 * is complete in the stream, and fills in (why, up next, evidence) when the answer finishes.
 *
 * It starts on an interim that looks finished (endpointing on punctuation and pauses), so most of
 * the model time overlaps the end of the prospect's sentence; the final adopts that run when the
 * words match. A newer turn, or the prospect carrying on, restarts the run and the card updates in
 * place until the rep speaks. Nothing throws out of here.
 */
export class LivePipeline {
  private runs = new Map<string, LiveRun>();
  private interims = new Map<string, InterimState>();
  private draws = new Map<string, { persona: Persona; lines: LiveCueInput['playbook'] }>();
  private predictions = new Map<string, Predictions>();
  private timings: LiveTimings[] = [];

  constructor(private s: Services) {}

  handle(callId: string, turnId: string, receivedAt = this.s.now()): Promise<void> {
    this.clearInterim(callId, turnId);
    const turn = this.s.store.view(callId)?.turns.find((t) => t.id === turnId && t.final);
    const prev = this.runs.get(callId);
    if (prev && prev.turnId === turnId && turn && sameUtterance(prev.text, turn.text)) {
      prev.finalAt = receivedAt;
      if (prev.t.cardMs !== null && prev.t.fromFinalMs === null) prev.t.fromFinalMs = prev.receivedAt + prev.t.cardMs - receivedAt;
      return prev.promise;
    }
    if (prev && prev.turnId === turnId && prev.inFlight && turn && this.s.config.latency.speculateWords > 0) {
      prev.pending = { text: turn.text, receivedAt, early: false };
      return prev.promise;
    }
    return this.start(callId, turnId, turn?.text ?? '', receivedAt, false);
  }

  interim(callId: string, turnId: string, text: string): void {
    let st = this.interims.get(callId);
    if (!st || st.turnId !== turnId) {
      if (st?.timer) clearTimeout(st.timer);
      st = { turnId, text: '', changedAt: this.s.now(), timer: null };
      this.interims.set(callId, st);
      if (this.s.config.latency.warm && this.s.models.configured) this.s.models.warm();
    }
    if (st.text !== text) {
      st.text = text;
      st.changedAt = this.s.now();
    }
    this.match(callId, turnId, text);
    if (this.s.config.latency.earlyTrigger) this.evaluate(callId, st);
    const n = this.s.config.latency.speculateWords;
    if (n > 0 && text.trim().split(/\s+/).filter(Boolean).length >= n) this.trigger(callId, turnId, text);
  }

  repSpeech(callId: string): void {
    const run = this.runs.get(callId);
    if (run && run.repSpokeAt === null) run.repSpokeAt = this.s.now();
  }

  supersede(callId: string, reason: string): void {
    if (reason === 'call ended') {
      this.clearInterim(callId);
      this.draws.delete(callId);
      this.predictions.get(callId)?.controller.abort(reason);
      this.predictions.delete(callId);
    }
    const run = this.runs.get(callId);
    if (!run) return;
    run.controller.abort(reason);
    if (reason === 'call ended') this.runs.delete(callId);
    if (!run.done) {
      run.done = true;
      this.append({ type: 'suggestion.skipped', callId, turnId: run.turnId, reason });
      run.t.outcome = 'superseded';
      this.record(run.t);
    }
  }

  async idle(callId?: string): Promise<void> {
    const pending = callId ? [this.runs.get(callId)].filter((r): r is LiveRun => !!r) : [...this.runs.values()];
    const predicted = callId ? [this.predictions.get(callId)].filter((p): p is Predictions => !!p) : [...this.predictions.values()];
    await Promise.all([...pending.map((r) => r.promise), ...predicted.map((p) => p.ready)]);
  }

  recentTimings(callId?: string): LiveTimings[] {
    return callId ? this.timings.filter((t) => t.callId === callId) : [...this.timings];
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
    const run = this.runs.get(callId);
    if (run && run.turnId === turnId && sameUtterance(run.text, text)) return;
    const view = this.s.store.view(callId);
    if (!view || view.status !== 'live') return;
    if (view.turns.some((t) => t.id === turnId && t.final)) return;
    // Speculating: never cut a run short for more words; they run as soon as it finishes.
    if (run && run.turnId === turnId && run.inFlight && this.s.config.latency.speculateWords > 0) {
      run.pending = { text, receivedAt: this.s.now(), early: true };
      return;
    }
    void this.start(callId, turnId, text, this.s.now(), true);
  }

  private clearInterim(callId: string, turnId?: string): void {
    const st = this.interims.get(callId);
    if (!st || (turnId && st.turnId !== turnId)) return;
    if (st.timer) clearTimeout(st.timer);
    this.interims.delete(callId);
  }

  private start(callId: string, turnId: string, text: string, receivedAt: number, early: boolean): Promise<void> {
    const prev = this.runs.get(callId);
    const same = prev && prev.turnId === turnId;
    if (prev) this.retire(prev, !!same);
    const run: LiveRun = {
      callId,
      turnId,
      text,
      early,
      controller: new AbortController(),
      receivedAt,
      finalAt: early ? null : receivedAt,
      card: same ? prev!.card : null,
      done: same ? !!prev!.card : false,
      repSpokeAt: same ? prev!.repSpokeAt : null,
      inFlight: true,
      pending: null,
      promise: Promise.resolve(),
      t: { callId, turnId, early, readMs: null, cardMs: null, doneMs: null, fromFinalMs: null, outcome: 'quiet', requestId: null },
    };
    this.runs.set(callId, run);
    run.promise = this.process(run)
      .catch((e: unknown) => this.fail(run, e))
      .then(() => {
        run.inFlight = false;
        const next = run.pending;
        run.pending = null;
        if (!next || this.runs.get(callId) !== run || run.controller.signal.aborted || sameUtterance(next.text, run.text)) return;
        return this.start(callId, turnId, next.text, next.receivedAt, next.early);
      });
    return run.promise;
  }

  /** Stops a run that a newer one replaces; one for an older turn that showed nothing is marked skipped. */
  private retire(prev: LiveRun, same: boolean): void {
    prev.controller.abort(same ? 'restarted' : 'superseded');
    if (same || prev.done) return;
    prev.done = true;
    this.append({ type: 'suggestion.skipped', callId: prev.callId, turnId: prev.turnId, reason: 'superseded' });
    prev.t.outcome = 'superseded';
    this.record(prev.t);
  }

  /**
   * While the rep says the card's line, pre-writes a line for each likely reply (the card's up next):
   * one live_cue call each, with that reply as the prospect's turn, and one embedding call for the
   * replies. Any failure just leaves that reply without a line.
   */
  private predict(run: LiveRun, input: LiveCueInput, card: Suggestion): void {
    const n = this.s.config.latency.predict;
    // The card's own guesses first, then the common replies this call hasn't had yet, for the rest.
    const seen = new Set<string>(card.upNext.map((u) => u.moment));
    for (const h of this.s.store.view(run.callId)?.history ?? []) seen.add(h.suggestion.situation.moment);
    const replies = [
      ...card.upNext.map((u) => u.ifTheySay.trim()).filter(Boolean),
      ...(MOMENT_META[card.situation.moment].suggests ? COMMON_REPLIES.filter((c) => !seen.has(c.moment)).map((c) => c.text) : []),
    ].slice(0, n);
    this.predictions.get(run.callId)?.controller.abort('superseded');
    this.predictions.delete(run.callId);
    if (n === 0 || replies.length === 0) return;
    const controller = new AbortController();
    const items: Prediction[] = replies.map((reply) => ({ reply, out: null, requestId: null }));
    const situation = card.situation;
    const writes = items.map(async (item) => {
      const r = await this.s.models.run(
        'live_cue',
        {
          ...input,
          previous: { persona: situation.persona, receptivity: situation.receptivity, moment: situation.moment },
          transcript: [...input.transcript, { speaker: 'rep' as const, text: card.say }, { speaker: 'prospect' as const, text: item.reply }].slice(-TRANSCRIPT_TURNS),
          already_said: [...input.already_said, card.say].slice(-6),
          last_response: item.reply,
        },
        { callId: run.callId, signal: controller.signal, budgetMs: this.s.config.budgets.liveMs },
      );
      if (r.ok) {
        item.out = r.output;
        item.requestId = r.requestId;
      }
    });
    const vecs = this.s.models.embed(replies, { signal: controller.signal, timeoutMs: EMBED_TIMEOUT_MS });
    const ready = Promise.allSettled([...writes, vecs]).then(() => undefined);
    this.predictions.set(run.callId, { items, vecs, ready, controller, turnId: null, triedAtWords: 0, attempts: 0, matching: false });
  }

  /**
   * Matches the prospect's first words to the predicted replies by meaning (embeddings, no regex).
   * A match shows that reply's pre-written line at once; the real live_cue run on the full sentence
   * then replaces it in place until the rep speaks. Tries again as the sentence grows, a few times.
   */
  private match(callId: string, turnId: string, text: string): void {
    const p = this.predictions.get(callId);
    if (!p || p.matching) return;
    if (p.turnId !== turnId) {
      p.turnId = turnId;
      p.triedAtWords = 0;
      p.attempts = 0;
    }
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const { predictMinWords } = this.s.config.latency;
    if (p.attempts >= MATCH_ATTEMPTS || words < predictMinWords || (p.attempts > 0 && words < p.triedAtWords + predictMinWords)) return;
    const run = this.runs.get(callId);
    if (run?.turnId === turnId && run.card) return;
    p.matching = true;
    p.attempts += 1;
    p.triedAtWords = words;
    void this.tryMatch(callId, turnId, text, p).finally(() => {
      p.matching = false;
    });
  }

  private async tryMatch(callId: string, turnId: string, text: string, p: Predictions): Promise<void> {
    const [heard, vecs] = await Promise.all([this.s.models.embed([text], { signal: p.controller.signal, timeoutMs: EMBED_TIMEOUT_MS }), p.vecs]);
    if (!heard?.[0] || !vecs || p.controller.signal.aborted || this.predictions.get(callId) !== p) return;
    const scores = vecs.map((v) => cosine(heard[0]!, v));
    const top = Math.max(...scores);
    const best = top >= this.s.config.latency.predictMatch ? scores.indexOf(top) : -1;
    this.s.log.info('live predict match', { callId, turnId, heard: clip(text, 80), top: Math.round(top * 100) / 100, replies: p.items.map((i) => clip(i.reply, 40)), ready: p.items.map((i) => !!i.out) });
    if (best < 0) return;
    const item = p.items[best]!;
    // A line still being written is waited for: it usually lands before the real run's would.
    if (!item.out) await p.ready;
    const o = item.out;
    if (!o || p.controller.signal.aborted) return;
    const view = this.s.store.view(callId);
    if (!view || view.status !== 'live') return;
    const situation = situationFrom(o, view.situation);
    const say = o.say.trim();
    if (!say || !situation.shouldSuggest || o.risky_claim || findRiskyClaims(say).length > 0) return;

    let run = this.runs.get(callId);
    if (run?.turnId === turnId) {
      // The real run for this turn is in flight: the predicted line goes up first, and it refines it.
      if (run.card || run.controller.signal.aborted) return;
    } else {
      if (run) this.retire(run, false);
      const now = this.s.now();
      run = {
        callId,
        turnId,
        text: '',
        early: true,
        controller: new AbortController(),
        receivedAt: now,
        finalAt: null,
        card: null,
        done: false,
        repSpokeAt: null,
        inFlight: false,
        pending: null,
        promise: Promise.resolve(),
        t: { callId, turnId, early: true, readMs: null, cardMs: null, doneMs: null, fromFinalMs: null, outcome: 'shown', requestId: item.requestId },
      };
      this.runs.set(callId, run);
    }
    const upNext: UpNext[] = o.up_next.slice(0, 3).map((u) => ({ ifTheySay: clip(u.if_they_say, 120), move: clip(u.move, 160), moment: u.moment }));
    const card: Suggestion = { ...this.card(run, situation, { say, why: o.why, upNext, lineId: o.line_id }, item.requestId), servedBy: 'cache', precomputed: 'predicted' };
    if (!this.show(run, card)) return;
    run.t.predicted = true;
    if (run.t.cardMs === null) run.t.cardMs = Math.max(0, this.s.now() - run.receivedAt);
    this.s.telemetry.link(item.requestId, callId, 'live_cue', card.id);
    if (!run.text) this.finish(run, 'shown');
  }

  private async process(run: LiveRun): Promise<void> {
    const { s } = this;
    const { callId, turnId } = run;
    const signal = run.controller.signal;
    const live = () => !signal.aborted;
    const view = s.store.view(callId);
    if (!view || view.status !== 'live') return this.skip(run, 'call not live');
    const turns = this.turnsFor(view, turnId, run.text);
    if (!turns) return this.skip(run, 'turn not found');
    if (!s.models.configured) {
      this.append({ type: 'pipeline.error', callId, stage: 'live_cue', message: 'MUBIT_API_KEY is not set: the live path has no rules fallback', retryable: false });
      return this.skip(run, 'not configured');
    }

    const input = this.inputFor(view, turns.list);
    const elapsed = () => s.now() - run.receivedAt;
    let early: { situation: Situation; say: string } | null = null;

    const onFields = (f: Record<string, string>) => {
      if (!live()) return;
      if (run.t.readMs === null && f.meaning !== undefined) run.t.readMs = elapsed();
      if (early || f.say === undefined) return;
      const say = f.say.trim();
      const situation = situationFrom(f, view.situation);
      // The line streams before the read: with no moment yet, a non-empty line is the signal to show it.
      const wanted = f.moment === undefined ? !!say : situation.shouldSuggest;
      // Quiet, risky or locked: wait for the full answer (the policy check needs it).
      if (!say || !wanted || findRiskyClaims(say).length > 0 || this.locked(run)) return;
      early = { situation, say };
      const card = this.card(run, situation, { say, why: '', upNext: [], lineId: f.line_id ?? NEW_LINE_ID }, null);
      if (this.show(run, card)) run.t.cardMs = elapsed();
    };

    const r = await s.models.run('live_cue', input, { callId, signal, budgetMs: s.config.budgets.liveMs, onFields });
    if (!live()) return;
    run.t.doneMs = elapsed();
    run.t.requestId = r.requestId;
    if (!r.ok) {
      if (!r.aborted) this.append({ type: 'pipeline.error', callId, stage: 'live_cue', message: clip(`${r.code}: ${r.message}`, 480), retryable: r.retryable });
      // A card already on screen stays; with none there is nothing honest to show.
      if (run.card) return this.finish(run, 'shown');
      run.t.outcome = 'error';
      return this.skip(run, `error: ${r.code}`);
    }

    const o = r.output;
    const situation = situationFrom(o, view.situation);
    this.append({
      type: 'situation.read',
      callId,
      turnId,
      situation,
      features: computeFeatures(turns.list, turns.index, { callStartedAt: view.startedAt }),
      latencyMs: Math.round(r.latencyMs),
      servedBy: 'mubit',
      ...(r.requestId ? { mubitRequestId: r.requestId } : {}),
    });
    let say = o.say.trim();
    let lineId = o.line_id;
    if (!say || !situation.shouldSuggest) {
      if (run.card) return this.finish(run, 'shown');
      return this.skip(run, MOMENT_META[situation.moment].suggests ? 'quiet: no card needed' : `quiet: ${situation.moment}`);
    }

    // Anything about cover, price or terms is checked before the rep can read it.
    if (o.risky_claim || findRiskyClaims(say).length > 0) {
      const check = await s.policy.check(say, 'rep', { callId, signal });
      if (!live()) return;
      s.telemetry.link(check.requestId, callId, 'check_claim');
      if (check.verdict === 'violation' || (check.verdict !== 'supported' && findRiskyClaims(say).length > 0)) {
        const safe = s.playbook.active().find((l) => l.moment === situation.moment && findRiskyClaims(l.text).length === 0);
        if (!safe) {
          run.t.outcome = 'blocked';
          return this.skip(run, 'policy: no safe line');
        }
        say = safe.text;
        lineId = safe.id;
      }
    }

    const upNext: UpNext[] = o.up_next.slice(0, 3).map((u) => ({ ifTheySay: clip(u.if_they_say, 120), move: clip(u.move, 160), moment: u.moment }));
    const card = this.card(run, situation, { say, why: o.why, upNext, lineId }, r.requestId);
    // Once the rep has started talking (or acted), only the details may change, never the words.
    if (run.card && this.locked(run) && run.card.say !== card.say) return this.finish(run, 'shown');
    if (this.show(run, card) && run.t.cardMs === null) run.t.cardMs = elapsed();
    // Links this Mubit request to the card, and later to the call's outcome (mubit_links).
    s.telemetry.link(r.requestId, callId, 'live_cue', run.card?.id);
    this.finish(run, 'shown');
    if (run.card) this.predict(run, input, run.card);
  }

  /** True once the rep has spoken (or acted on the card) since this prospect turn. */
  private locked(run: LiveRun): boolean {
    if (run.repSpokeAt !== null) return true;
    const id = run.card?.id;
    return !!id && (this.s.store.view(run.callId)?.history.find((h) => h.suggestion.id === id)?.action ?? null) !== null;
  }

  private show(run: LiveRun, card: Suggestion): boolean {
    if (run.controller.signal.aborted) return false;
    if (!this.append({ type: 'suggestion.shown', callId: run.callId, suggestion: card })) return false;
    run.card = card;
    run.done = true;
    if (run.finalAt !== null && run.t.fromFinalMs === null) run.t.fromFinalMs = this.s.now() - run.finalAt;
    return true;
  }

  private card(run: LiveRun, situation: Situation, line: { say: string; why: string; upNext: UpNext[]; lineId: string }, requestId: string | null): Suggestion {
    const now = this.s.now();
    const known = this.s.playbook.active().find((l) => l.id === line.lineId);
    const evidence: Evidence = known
      ? clampEvidence(evidenceFor(known, situationKey(situation), this.s.playbook.active().filter((l) => l.moment === known.moment)))
      : { text: 'New line, written for this moment', calls: 0, basis: 'model' };
    const first = run.card;
    return {
      id: first?.id ?? newId('sug'),
      callId: run.callId,
      turnId: run.turnId,
      situation,
      say: clip(line.say, 320),
      why: clip(line.why || evidence.text, 200),
      lineId: known ? known.id : NEW_LINE_ID,
      evidence,
      upNext: line.upNext,
      kind: 'line',
      createdAt: first?.createdAt ?? now,
      latencyMs: first?.latencyMs ?? Math.max(0, Math.round(now - run.receivedAt)),
      servedBy: 'mubit',
      mubitRequestIds: requestId ? [requestId] : [],
      ...(first ? { stage: 'refined' as const, refinedAt: now, refinedLatencyMs: Math.max(0, Math.round(now - run.receivedAt)) } : {}),
    };
  }

  /** The live_cue input. Stable parts first (who, brief, the call's playbook draw) so the provider can cache the prefix. */
  private inputFor(view: CallView, turns: Turn[]): LiveCueInput {
    const brief = view.brief;
    const corgi = brief?.corgi;
    return {
      prospect: { name: view.prospect.name, title: view.prospect.title, company: view.prospect.company },
      rep: { name: view.rep.name, company: this.s.config.seller.company },
      // The research, kept short: it is context for the line, not something to read out.
      brief: {
        summary: clip(brief?.summary ?? '', 220),
        opener: clip(brief?.opener ?? '', 160),
        risk: clip(corgi?.risk ?? '', 160),
        policies: (corgi?.policies ?? []).slice(0, 3).map((p) => clip(`${p.name}: ${p.reason}`, 120)),
        facts: [
          ...(corgi?.sec ? [`Form ${corgi.sec.form}${corgi.sec.sure ? ' verified' : ' (unverified match)'}: ${corgi.sec.line}`] : []),
          ...(corgi?.facts ?? []),
          ...(brief?.hooks ?? []).map((h) => h.hook),
          ...Object.entries(view.prospect.facts).map(([k, v]) => `${k}: ${v}`),
        ]
          .slice(0, 6)
          .map((f) => clip(f, 140)),
      },
      playbook: this.draw(view),
      previous: view.situation ? { persona: view.situation.persona, receptivity: view.situation.receptivity, moment: view.situation.moment } : null,
      transcript: turns.slice(-TRANSCRIPT_TURNS).map((t) => ({ speaker: t.speaker, text: clipTail(t.text, TURN_CHARS) })),
      already_said: view.history.map((h) => h.suggestion.say).slice(-6),
      last_response: clipTail(turns.at(-1)?.speaker === 'prospect' ? turns.at(-1)!.text : '', TURN_CHARS),
    };
  }

  /**
   * The playbook lines this call's prompt carries: the top lines per moment by Thompson sampling, for
   * who we think is on the line. Drawn once per call (and again if the person changes), so the prompt
   * prefix stays the same from turn to turn.
   */
  private draw(view: CallView): LiveCueInput['playbook'] {
    const persona: Persona = view.situation?.persona ?? view.brief?.personaGuess ?? 'unknown';
    const cached = this.draws.get(view.id);
    if (cached && cached.persona === persona) return cached.lines;
    const active = this.s.playbook.active();
    const lines: LiveCueInput['playbook'] = [];
    for (const moment of MOMENTS) {
      if (!MOMENT_META[moment].suggests) continue;
      for (const r of rankLines(active, { persona, receptivity: view.situation?.receptivity ?? 'neutral', moment }, { k: LINES_PER_MOMENT, rng: this.s.rng, exploreSlot: true })) {
        const st = r.stats;
        lines.push({ line_id: r.line.id, moment, style: r.line.style, text: r.line.text, used: st.used, wins: st.stepWins, booked: st.booked });
      }
    }
    this.draws.set(view.id, { persona, lines });
    return lines;
  }

  private turnsFor(view: CallView, turnId: string, text: string): { list: Turn[]; index: number } | null {
    const list = view.turns.filter((x) => x.final || x.id === turnId);
    const index = list.findIndex((x) => x.id === turnId);
    if (index < 0) return null;
    if (!list[index]!.final && text) list[index] = { ...list[index]!, text };
    return { list: list.slice(0, index + 1), index };
  }

  private skip(run: LiveRun, reason: string): void {
    if (run.controller.signal.aborted || run.done) return;
    run.done = true;
    this.append({ type: 'suggestion.skipped', callId: run.callId, turnId: run.turnId, reason: clip(reason, 200) });
    this.record(run.t);
  }

  private finish(run: LiveRun, outcome: LiveTimings['outcome']): void {
    run.t.outcome = outcome;
    this.record(run.t);
  }

  private fail(run: LiveRun, e: unknown): void {
    if (run.controller.signal.aborted) return;
    const message = clip(e instanceof Error ? e.message : String(e), 480);
    this.s.log.error('live pipeline failed', { callId: run.callId, message });
    this.append({ type: 'pipeline.error', callId: run.callId, stage: 'live_cue', message, retryable: true });
    run.t.outcome = 'error';
    this.skip(run, 'error');
  }

  /** Keeps the run's own timings object, so a final that adopts an early run can still fill in `fromFinalMs`. */
  private record(t: LiveTimings): void {
    if (this.timings.includes(t)) return;
    this.timings.push(t);
    if (this.timings.length > 500) this.timings.splice(0, this.timings.length - 500);
  }

  private append(input: CallEventInput): boolean {
    try {
      this.s.store.append(input);
      return true;
    } catch (e) {
      this.s.log.error('append failed', { type: input.type, message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
}

/** How long an embedding may take before the match is given up (Mubit's `/embeddings` has rare 30 s outliers). */
const EMBED_TIMEOUT_MS = 900;
/**
 * Replies that come up on most cold calls, pre-written when the card's own guesses leave room. Fixed
 * text (no prospect detail): the prospect-specific part is in the line live_cue writes for them.
 */
const COMMON_REPLIES: { moment: Moment; text: string }[] = [
  { moment: 'objection_broker', text: 'We already have a broker' },
  { moment: 'objection_not_interested', text: "We're not interested, thanks" },
  { moment: 'brush_off_email', text: 'Just send me an email' },
  { moment: 'objection_price', text: 'How much does it cost?' },
  { moment: 'brush_off_busy', text: "I'm busy right now" },
];

/** Match attempts per prospect turn, as the sentence grows. */
const MATCH_ATTEMPTS = 3;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** A Situation from live_cue's read (whole or still streaming). Unknown values keep the previous read. */
export function situationFrom(o: Partial<Pick<LiveCueOutput, 'meaning' | 'moment' | 'persona' | 'receptivity' | 'say'>> | Record<string, string>, previous: Situation | null): Situation {
  const moment: Moment = isOne(MOMENTS, o.moment) ? o.moment : (previous?.moment ?? 'other');
  const persona: Persona = isOne(PERSONAS, o.persona) ? o.persona : (previous?.persona ?? 'unknown');
  const receptivity: Receptivity = isOne(RECEPTIVITY, o.receptivity) ? o.receptivity : (previous?.receptivity ?? 'neutral');
  const score = RECEPTIVITY_SCORE[receptivity];
  const warmth = (score + 1) / 2;
  return {
    persona,
    personaConfidence: isOne(PERSONAS, o.persona) ? 0.8 : 0.4,
    receptivity,
    receptivityScore: score,
    moment,
    momentConfidence: isOne(MOMENTS, o.moment) ? 0.8 : 0.3,
    tone: { engagement: warmth, warmth, patience: warmth, interest: warmth },
    signals: [],
    shouldSuggest: MOMENT_META[moment].suggests && (o.say === undefined || o.say.trim() !== ''),
    rationale: clip(o.meaning ?? '', 300),
  };
}

function clampEvidence(e: Evidence): Evidence {
  return { ...e, text: clip(e.text, 200) };
}
