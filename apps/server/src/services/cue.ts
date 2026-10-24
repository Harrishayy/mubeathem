import {
  MOMENTS,
  type AddTurnRequest,
  type Brief,
  type CallRecord,
  type CallView,
  type CreateCallRequest,
  type EndCallRequest,
  type FeedbackRequest,
  type HealthResponse,
  type OutcomeRecord,
  type PlaybookLine,
  type PlaybookResponse,
  type Prospect,
  type StatsResponse,
  type SuggestionActionRequest,
  type TaskId,
  type Turn,
} from '@cue/core';
import { buildCallRecord, evidenceFor, newId } from '../adapters/core';
import { briefFor, runBrief } from '../pipeline/brief';
import { research } from '../pipeline/research';
import { practiceNext, PracticeError, type PracticeReply } from '../pipeline/practice';
import { RepTurnPipeline } from '../pipeline/rep-turn';
import { ReviewPipeline } from '../pipeline/review';
import { TurnPipeline } from '../pipeline/turn';
import { ContactStore } from '../store/contacts';
import { TrellusService } from '../trellus';
import { VERSION } from '../version';
import { TASK_TIER } from './models';
import type { Services } from './context';

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const OUTCOME_TRUST: Record<OutcomeRecord['source'], number> = { review: 0, rep: 1, trellus: 2, hubspot: 3 };

/** The server's use cases. Routes, the seed script and tests all go through this. */
export class Cue {
  readonly turns: TurnPipeline;
  readonly repTurns: RepTurnPipeline;
  readonly reviews: ReviewPipeline;
  readonly trellus: TrellusService;
  readonly contacts: ContactStore;
  private background = new Set<Promise<void>>();

  constructor(readonly s: Services) {
    this.turns = new TurnPipeline(s);
    this.repTurns = new RepTurnPipeline(s);
    this.reviews = new ReviewPipeline(s);
    this.contacts = new ContactStore(s.db, s.now);
    this.trellus = new TrellusService(s, (callId, outcome) => this.recordOutcome(callId, outcome));
  }

  private track(p: Promise<void>): void {
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  /** Resolves when nothing is in flight: briefs, turns, rep turns, reviews. For tests and seeding. */
  async idle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await Promise.all([...this.background]);
      await this.turns.idle();
      await this.repTurns.idle();
      await this.reviews.idle();
      if (!this.background.size) return;
    }
  }

  private requireView(callId: string): CallView {
    const v = this.s.store.view(callId);
    if (!v) throw new AppError(404, 'not_found', `No call ${callId}`);
    return v;
  }

  createCall(req: CreateCallRequest): CallView {
    const callId = newId('call');
    let prospect = req.prospect;
    if (req.contactId) {
      const saved = this.contacts.prospect(req.contactId);
      if (!saved) throw new AppError(404, 'not_found', `No contact ${req.contactId}`);
      // what the rep typed on the form wins over the saved record, field by field
      const typed = Object.fromEntries(Object.entries(req.prospect).filter(([k, v]) => k !== 'facts' && typeof v === 'string' && v.trim()));
      prospect = { ...saved, ...typed, facts: { ...saved.facts, ...req.prospect.facts } };
    }
    this.s.store.append({
      type: 'call.started',
      callId,
      source: req.source,
      prospect,
      rep: req.rep,
      ...(req.trellusSessionId ? { trellusSessionId: req.trellusSessionId } : {}),
      ...(req.contactId ? { contactId: req.contactId } : {}),
    });
    if (req.practice || req.source === 'practice') this.s.store.setPractice(callId, { mood: req.practice?.mood ?? 'neutral', objections: req.practice?.objections ?? [] });
    this.track(runBrief(this.s, callId));
    return this.requireView(callId);
  }

  /** Fires pre-call research (cached), so starting the call gets its brief without waiting on the web. */
  warmResearch(req: { contactId?: string; prospect?: Prospect }): { configured: boolean; providers: string[] } {
    const prospect = req.contactId ? this.contacts.prospect(req.contactId) : (req.prospect ?? null);
    if (req.contactId && !prospect) throw new AppError(404, 'not_found', `No contact ${req.contactId}`);
    const providers = [...(this.s.config.exaApiKey ? ['exa'] : []), ...(this.s.config.valyuApiKey ? ['valyu'] : [])];
    if (prospect && providers.length) this.track(research(this.s, prospect).then(() => undefined));
    return { configured: providers.length > 0, providers };
  }

  /** The brief before the call, for the side panel while Trellus dials. Same cache as the call's brief. */
  async researchBrief(req: { contactId?: string; prospect?: Prospect }): Promise<{ brief: Brief; configured: boolean; providers: string[] }> {
    const prospect = req.contactId ? this.contacts.prospect(req.contactId) : (req.prospect ?? null);
    if (!prospect) throw new AppError(404, 'not_found', `No contact ${req.contactId ?? ''}`.trim());
    const providers = [...(this.s.config.exaApiKey ? ['exa'] : []), ...(this.s.config.valyuApiKey ? ['valyu'] : [])];
    const { brief } = await briefFor(this.s, prospect);
    return { brief, configured: providers.length > 0, providers };
  }

  getCall(callId: string): CallView {
    return this.requireView(callId);
  }

  /** Appends a turn; final prospect turns run the live pipeline, final rep turns the claim check. Idempotent by turn id. */
  addTurn(callId: string, req: AddTurnRequest): { turnId: string; duplicate: boolean } {
    const view = this.requireView(callId);
    if (view.status !== 'live') throw new AppError(409, 'call_ended', 'The call has ended');
    const receivedAt = this.s.now();
    const id = req.id ?? newId('turn');
    const existing = view.turns.find((t) => t.id === id);
    if (existing?.final) return { turnId: id, duplicate: true };
    const turn: Turn = {
      id,
      speaker: req.speaker,
      text: req.text,
      tMs: req.tMs ?? Math.max(0, receivedAt - view.startedAt),
      ...(req.durMs !== undefined ? { durMs: req.durMs } : {}),
      final: req.final,
      via: req.via,
    };
    this.s.store.append({ type: 'turn.added', callId, turn });
    // Any rep speech locks the card on screen (no refinement swaps under the rep's eyes).
    if (turn.speaker === 'rep') this.turns.repSpeech(callId);
    if (turn.final) {
      if (turn.speaker === 'prospect') this.track(this.turns.handle(callId, id, receivedAt));
      else this.track(this.repTurns.handle(callId, id, receivedAt));
    } else if (turn.speaker === 'prospect' && req.id) {
      // Interims with a stable id can start the turn early (endpointing, architecture.md §5.3).
      this.turns.interim(callId, id, turn.text);
    }
    return { turnId: id, duplicate: false };
  }

  suggestionAction(callId: string, suggestionId: string, req: SuggestionActionRequest): void {
    const view = this.requireView(callId);
    if (!view.history.some((h) => h.suggestion.id === suggestionId)) throw new AppError(404, 'not_found', `No suggestion ${suggestionId} on this call`);
    this.s.store.append({ type: 'suggestion.action', callId, suggestionId, action: req.action, ...(req.text ? { text: req.text } : {}) });
  }

  endCall(callId: string, req: EndCallRequest): CallView {
    const view = this.requireView(callId);
    if (view.status === 'live') {
      this.turns.supersede(callId, 'call ended');
      this.s.store.append({ type: 'call.ended', callId, durationMs: Math.max(0, this.s.now() - view.startedAt) });
    }
    if (req.outcome) this.recordOutcome(callId, { outcome: req.outcome, source: 'rep', raw: {}, at: this.s.now() });
    return this.requireView(callId);
  }

  /** Keeps the most trusted outcome (rep tap < Trellus < HubSpot); a changed outcome re-reviews a reviewed call. */
  recordOutcome(callId: string, outcome: OutcomeRecord): void {
    const view = this.s.store.view(callId);
    if (!view) return;
    const cur = view.outcome;
    if (cur && OUTCOME_TRUST[outcome.source] < OUTCOME_TRUST[cur.source]) return;
    if (cur && cur.outcome === outcome.outcome && cur.source === outcome.source) return;
    this.s.store.append({ type: 'outcome.recorded', callId, outcome });
    if (view.status === 'reviewed' && cur?.outcome !== outcome.outcome) this.track(this.reviews.queue(callId));
  }

  feedback(callId: string, req: FeedbackRequest): CallView {
    let view = this.requireView(callId);
    if (view.status === 'live') view = this.endCall(callId, {});
    this.s.store.append({ type: 'feedback.submitted', callId, feedback: { ...req, submittedAt: this.s.now() } });
    if (!view.outcome || (view.outcome.source === 'rep' && view.outcome.outcome !== req.outcome)) this.recordOutcome(callId, { outcome: req.outcome, source: 'rep', raw: {}, at: this.s.now() });
    this.track(this.reviews.queue(callId));
    return this.requireView(callId);
  }

  async practiceNext(callId: string): Promise<PracticeReply> {
    try {
      const reply = await practiceNext(this.s, this.turns, callId);
      this.track(reply.done);
      return reply;
    } catch (e) {
      if (e instanceof PracticeError) throw new AppError(e.code === 'not_found' ? 404 : 409, e.code, e.message);
      throw e;
    }
  }

  record(callId: string): CallRecord {
    this.requireView(callId);
    return buildCallRecord(this.s.store.list(callId));
  }

  *exportRecords(limit = 500): Generator<CallRecord> {
    for (const c of this.s.store.calls({ limit })) yield buildCallRecord(this.s.store.list(c.id));
  }

  playbook(): PlaybookResponse {
    const lines = this.s.playbook.all();
    const leaderboard = MOMENTS.map((moment) => {
      const ls = lines
        .filter((l) => l.moment === moment && l.status === 'active')
        .map((l) => {
          const st = l.stats['*'];
          const rate = st && st.shown ? (Math.max(st.stepWins, st.booked) + 1) / (st.shown + 2) : 0;
          return { l, rate };
        })
        .sort((a, b) => b.rate - a.rate)
        .map(({ l }) => ({ lineId: l.id, text: l.text, evidence: evidenceFor(l, '*') }));
      return { moment, lines: ls };
    }).filter((g) => g.lines.length);
    return { lines, leaderboard, updatedAt: this.s.playbook.updatedAt() };
  }

  setLineStatus(lineId: string, status: 'active' | 'rejected'): PlaybookLine {
    const line = this.s.playbook.get(lineId);
    if (!line) throw new AppError(404, 'not_found', `No line ${lineId}`);
    if (status === 'active' && line.policy?.verdict === 'violation') throw new AppError(409, 'policy_violation', 'This line failed the policy check and cannot be approved');
    if (status === 'active' && line.status !== 'candidate' && line.status !== 'active') throw new AppError(409, 'not_candidate', `Line is ${line.status}`);
    const next: PlaybookLine = { ...line, status, origin: status === 'active' && line.origin === 'model' ? 'manager' : line.origin };
    this.s.playbook.save([next]);
    return next;
  }

  stats(): StatsResponse {
    const models = Object.fromEntries(Object.entries(TASK_TIER).map(([t, tier]) => [t, this.s.models.models[tier]])) as Record<TaskId, string>;
    const all = this.s.playbook.all();
    return {
      tasks: this.s.telemetry.stats(models),
      calls: this.s.store.countCalls(),
      playbook: { active: all.filter((l) => l.status === 'active').length, candidates: all.filter((l) => l.status === 'candidate').length },
    };
  }

  /** Newest evidence wins: the last real call, or the startup ping. Null = not configured / untested. */
  private mubitReachable(): boolean | null {
    if (!this.s.models.configured) return null;
    const last = this.s.telemetry.last();
    const ping = this.s.models.lastPing;
    if (last && (!ping || last.at >= ping.at)) return last.ok || !['network', 'timeout', 'http'].includes(last.errorCode ?? '');
    return ping?.ok ?? null;
  }

  health(): HealthResponse {
    const t = this.trellus.status();
    return {
      ok: true,
      version: VERSION,
      mubit: { configured: this.s.models.configured, reachable: this.mubitReachable(), models: this.s.models.models },
      trellus: { configured: t.configured, reachable: t.reachable, lastSyncAt: t.lastSyncAt },
      sapling: { configured: !!this.s.config.saplingUrl },
      exa: { configured: !!this.s.config.exaApiKey },
      valyu: { configured: !!this.s.config.valyuApiKey },
      store: { path: this.s.config.dbPath, calls: this.s.store.countCalls().total },
    };
  }
}
