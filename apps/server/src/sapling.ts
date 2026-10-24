import { POLICY_VERDICTS, type PolicyVerdict } from '@cue/core';

export interface SaplingVerdict {
  verdict: PolicyVerdict;
  rule: string | null;
  rephrase: string | null;
}

/**
 * Optional self-hosted Banyan Sapling: `POST {SAPLING_URL}` with `{claim, policy, evidence}`.
 * Accepts `verdict`, `status` or `label` in the answer (calibrated `status: unsure` wins over the
 * raw label, per the model card). Any failure returns null so the caller falls back to Mubit.
 */
export async function saplingCheck(
  url: string,
  body: { claim: string; policy: string[]; evidence: string[] },
  opts: { signal?: AbortSignal; timeoutMs: number; fetch?: typeof fetch },
): Promise<SaplingVerdict | null> {
  if (!url) return null;
  const f = opts.fetch ?? fetch;
  try {
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs);
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, policy: body.policy.join('\n') }), signal });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const pick = (v: unknown) => (typeof v === 'string' ? (v.toLowerCase().replace(/\s+/g, '_') as PolicyVerdict) : null);
    const status = pick(json.status);
    const verdict = status === 'unsure' ? 'unsure' : (pick(json.verdict) ?? pick(json.label) ?? status);
    if (!verdict || !POLICY_VERDICTS.includes(verdict)) return null;
    return {
      verdict,
      rule: typeof json.rule === 'string' ? json.rule : null,
      rephrase: typeof json.rephrase === 'string' ? json.rephrase : null,
    };
  } catch {
    return null;
  }
}
