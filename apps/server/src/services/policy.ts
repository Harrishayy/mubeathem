import type { PolicyVerdict, Speaker } from '@cue/core';
import { CORGI_POLICY, findRiskyClaims } from '../adapters/core';
import { saplingCheck } from '../sapling';
import type { ModelRunner } from './models';

export interface ClaimCheck {
  claim: string;
  verdict: PolicyVerdict;
  rule: string;
  rephrase: string | null;
  via: 'sapling' | 'mubit' | 'rules';
  requestId: string | null;
}

/** What is known before underwriting; sent as evidence so "covered"/price claims can't be supported. */
export const DEFAULT_EVIDENCE = ['No quote has been generated on this call.', 'Underwriting has not started.', 'Coverage terms depend on the quote and underwriting.'];

/**
 * Sapling when configured, else Mubit `check_claim`, else the rules pre-filter. The rules answer is
 * labelled `via: 'rules'` and only says `violation` when a known risky phrase matched.
 */
export class PolicyChecker {
  constructor(
    private models: ModelRunner,
    private opts: { saplingUrl: string; budgetMs: number; fetch?: typeof fetch },
  ) {}

  async check(claim: string, speaker: Speaker, ctx: { callId: string; signal?: AbortSignal; evidence?: string[] }): Promise<ClaimCheck> {
    const evidence = [...DEFAULT_EVIDENCE, ...(ctx.evidence ?? [])].slice(0, 12);
    const risky = findRiskyClaims(claim)[0];
    if (this.opts.saplingUrl) {
      const s = await saplingCheck(this.opts.saplingUrl, { claim, policy: CORGI_POLICY, evidence }, { ...(ctx.signal ? { signal: ctx.signal } : {}), timeoutMs: this.opts.budgetMs, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) });
      if (s) return { claim, verdict: s.verdict, rule: s.rule ?? risky?.rule ?? '', rephrase: s.rephrase ?? risky?.rephrase ?? null, via: 'sapling', requestId: null };
    }
    const r = await this.models.run('check_claim', { claim, speaker, policy: CORGI_POLICY, evidence }, { callId: ctx.callId, ...(ctx.signal ? { signal: ctx.signal } : {}), budgetMs: this.opts.budgetMs });
    if (r.ok)
      return {
        claim,
        verdict: r.output.verdict,
        rule: r.output.rule || risky?.rule || '',
        rephrase: r.output.rephrase ?? (r.output.verdict === 'violation' ? (risky?.rephrase ?? null) : null),
        via: 'mubit',
        requestId: r.requestId,
      };
    return risky
      ? { claim, verdict: 'violation', rule: risky.rule, rephrase: risky.rephrase, via: 'rules', requestId: null }
      : { claim, verdict: 'unsure', rule: 'No checker available; rules found nothing specific', rephrase: null, via: 'rules', requestId: null };
  }
}
