import type { Situation, Suggestion } from '@cue/core';
import { findRiskyClaims, matchUsage, newId, USAGE_THRESHOLD } from '../adapters/core';
import { clip, type Services } from '../services/context';

export { USAGE_THRESHOLD };

const NEUTRAL_SITUATION: Situation = {
  persona: 'unknown',
  personaConfidence: 0,
  receptivity: 'neutral',
  receptivityScore: 0,
  moment: 'compliance',
  momentConfidence: 1,
  tone: { engagement: 0.5, warmth: 0.5, patience: 0.5, interest: 0.5 },
  signals: [],
  shouldSuggest: true,
  rationale: 'Rep claim needs a safe rephrase',
};

/**
 * Final rep turns, one at a time per call: usage matching against the card on screen, then the
 * claim pre-filter → policy check → `policy.checked` (+ a compliance card on a violation).
 * `unsure` results are logged for the manager review list, never shown live (context.md §8).
 */
export class RepTurnPipeline {
  private chains = new Map<string, Promise<void>>();

  constructor(private s: Services) {}

  handle(callId: string, turnId: string, receivedAt = this.s.now()): Promise<void> {
    const prev = this.chains.get(callId) ?? Promise.resolve();
    const next = prev
      .then(() => this.process(callId, turnId, receivedAt))
      .catch((e: unknown) => {
        try {
          this.s.store.append({ type: 'pipeline.error', callId, stage: 'rep_turn', message: clip(e instanceof Error ? e.message : String(e), 480), retryable: true });
        } catch {
          /* store gone (shutdown) */
        }
      });
    this.chains.set(callId, next);
    void next.finally(() => {
      if (this.chains.get(callId) === next) this.chains.delete(callId);
    });
    return next;
  }

  async idle(): Promise<void> {
    while (this.chains.size) await Promise.all([...this.chains.values()]);
  }

  private async process(callId: string, turnId: string, receivedAt: number): Promise<void> {
    const { s } = this;
    const view = s.store.view(callId);
    if (!view) return;
    const turn = view.turns.find((t) => t.id === turnId && t.final);
    if (!turn) return;

    // 1. Did the rep just say the card?
    const card = view.current;
    if (card && card.kind === 'line') {
      const already = view.history.find((h) => h.suggestion.id === card.id)?.action === 'used';
      const m = matchUsage(turn.text, [card.say]);
      if (!already && m && m.score >= USAGE_THRESHOLD) s.store.append({ type: 'suggestion.action', callId, suggestionId: card.id, action: 'used', text: clip(turn.text, 400) });
    }

    // 2. Claims the rep can't make.
    const hits = findRiskyClaims(turn.text);
    if (!hits.length) return;
    const claim = clip(turn.text, 400);
    const check = await s.policy.check(turn.text, 'rep', { callId, evidence: view.prospect.facts ? Object.entries(view.prospect.facts).map(([k, v]) => `${k}: ${v}`) : [] });
    const rephrase = check.rephrase ?? hits[0]!.rephrase;
    s.store.append({
      type: 'policy.checked',
      callId,
      check: { claim, verdict: check.verdict, rule: clip(check.rule || hits[0]!.rule, 300), ...(rephrase ? { rephrase: clip(rephrase, 320) } : {}), via: check.via, speaker: 'rep', turnId },
    });
    s.telemetry.link(check.requestId, callId, 'check_claim');
    if (check.verdict !== 'violation') return;

    const latest = s.store.view(callId);
    if (!latest || latest.status !== 'live') return;
    const suggestion: Suggestion = {
      id: newId('sug'),
      callId,
      turnId,
      situation: { ...(latest.situation ?? NEUTRAL_SITUATION), moment: 'compliance', shouldSuggest: true, rationale: 'Rep claim needs a safe rephrase' },
      say: clip(rephrase, 320),
      why: clip(check.rule || hits[0]!.rule, 200),
      lineId: 'line_compliance',
      evidence: { text: clip(`Policy: ${check.rule || hits[0]!.rule}`, 200), calls: 0, basis: 'model' },
      upNext: [],
      kind: 'compliance',
      compliance: { claim, verdict: check.verdict, rule: clip(check.rule || hits[0]!.rule, 300), rephrase: clip(rephrase, 320) },
      createdAt: s.now(),
      latencyMs: Math.max(0, Math.round(s.now() - receivedAt)),
      // Suggestion.servedBy has no 'sapling'; the flag's `via` says which checker answered.
      servedBy: check.via === 'mubit' ? 'mubit' : 'rules',
      mubitRequestIds: check.requestId ? [check.requestId] : [],
    };
    s.store.append({ type: 'suggestion.shown', callId, suggestion });
    s.telemetry.link(check.requestId, callId, 'check_claim', suggestion.id);
  }
}
