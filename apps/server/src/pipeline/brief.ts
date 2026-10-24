import type { Brief, BriefSource, ProductLine, Prospect, ResearchHook } from '@cue/core';
import { personaFromTitle } from '../adapters/core';
import { clip, type Services } from '../services/context';
import { crmFindings, research, researchKey, type Finding } from './research';

interface Composed {
  brief: Brief;
  /** The Mubit request that wrote it, to link to the call that uses it. */
  requestId: string | null;
  /** Why the model wasn't used, when it was configured and failed. */
  error: { message: string; retryable: boolean } | null;
}

const briefs = new WeakMap<Services, Map<string, { at: number; composed: Promise<Composed> }>>();

/**
 * Web research (Exa and Valyu in parallel, when keyed) plus CRM facts → `research_brief`, with every
 * hook citing where it came from; the rules brief from CRM facts when the model isn't used. Never
 * throws. `cacheKey` is the prompt cache key: the call id, or a per-person key before the call.
 */
async function composeBrief(s: Services, p: Prospect, repName: string, cacheKey: string): Promise<Composed> {
  const web = await research(s, p);
  const findings: Finding[] = [...web, ...crmFindings(p).slice(0, web.length ? 4 : 8)];
  const sources: BriefSource[] = findings.slice(0, 12).map((f) => ({ title: clip(f.title || f.url || 'Untitled', 200), url: f.url, via: f.via, publishedAt: f.publishedAt ? f.publishedAt.slice(0, 40) : null }));

  const r = await s.models.run(
    'research_brief',
    {
      prospect: { name: p.name, title: p.title, company: p.company, facts: p.facts },
      findings: findings.map(({ title, text, url, publishedAt }) => ({ title, text, url, publishedAt })),
      seller: s.config.seller,
    },
    { callId: cacheKey, budgetMs: s.config.budgets.briefMs },
  );
  if (r.ok) {
    return {
      brief: {
        summary: clip(r.output.summary, 400),
        hooks: r.output.hooks.slice(0, 5).map((h) => {
          const from = h.source ? cited(findings, h.source) : null;
          return {
            hook: clip(h.hook, 240),
            product: h.product,
            ...(h.source ? { source: clip(h.source, 400) } : {}),
            via: from?.via ?? (web.length ? 'web' : 'crm'),
            ...(from?.url ? { url: from.url.slice(0, 2000) } : {}),
          };
        }),
        opener: clip(r.output.opener, 320),
        personaGuess: r.output.persona_guess,
        servedBy: 'mubit',
        sources,
      },
      requestId: r.requestId,
      error: null,
    };
  }
  return {
    brief: { ...rulesBrief(p, repName, s.config.seller.company), sources },
    requestId: null,
    error: r.code === 'not_configured' ? null : { message: `${r.code}: ${r.message}`, retryable: r.retryable },
  };
}

/**
 * The brief for one person, cached for `research.cacheMinutes` (as the research is), so the brief the
 * rep reads while dialling is the one the call opens with. A failed model call isn't cached. Its
 * Mubit session is the call when there is one, else a per-person key (the brief before the call).
 */
export function briefFor(s: Services, p: Prospect, repName = '', callId?: string): Promise<Composed> {
  const key = researchKey(p);
  const ttl = s.config.research.cacheMinutes * 60_000;
  let byKey = briefs.get(s);
  if (!byKey) briefs.set(s, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && ttl > 0 && s.now() - hit.at < ttl) return hit.composed;
  const composed = composeBrief(s, p, repName, callId ?? `brief_${key.replace(/[^a-z0-9|]+/g, '-').slice(0, 80)}`).catch((e): Composed => ({
    brief: rulesBrief(p, repName, s.config.seller.company),
    requestId: null,
    error: { message: e instanceof Error ? e.message : String(e), retryable: true },
  }));
  if (ttl > 0) {
    byKey.set(key, { at: s.now(), composed });
    void composed.then((c) => c.error && byKey.get(key)?.composed === composed && byKey.delete(key));
    while (byKey.size > 500) byKey.delete(byKey.keys().next().value as string);
  }
  return composed;
}

/**
 * Call start, never on the live path: the person's brief (from the cache when the rep already saw it
 * while dialling) → `brief.ready`. Falls back to a rules brief from the CRM facts, labelled
 * `servedBy: 'rules'`.
 */
export async function runBrief(s: Services, callId: string): Promise<void> {
  try {
    const view = s.store.view(callId);
    if (!view) return;
    const { brief, requestId, error } = await briefFor(s, view.prospect, view.rep.name, callId);
    if (requestId) s.telemetry.link(requestId, callId, 'research_brief');
    if (error) s.store.append({ type: 'pipeline.error', callId, stage: 'research_brief', message: clip(`${error.message}; served by rules`, 480), retryable: error.retryable });
    s.store.append({ type: 'brief.ready', callId, brief });
  } catch (e) {
    s.log.warn('brief failed', { callId, message: e instanceof Error ? e.message : String(e) });
    try {
      s.store.append({ type: 'pipeline.error', callId, stage: 'research_brief', message: clip(e instanceof Error ? e.message : String(e), 480), retryable: true });
    } catch {
      /* call gone */
    }
  }
}

/** The finding a hook's `source` points at: its URL, its title, or a CRM fact name. */
export function cited(findings: Finding[], source: string): Finding | null {
  const s = source.toLowerCase();
  return (
    findings.find((f) => f.url && s.includes(f.url.toLowerCase())) ??
    findings.find((f) => f.title && (s.includes(f.title.toLowerCase()) || f.title.toLowerCase().includes(s))) ??
    findings.find((f) => f.url && (() => { try { return s.includes(new URL(f.url).hostname.replace(/^www\./, '')); } catch { return false; } })()) ??
    null
  );
}

/** A brief from CRM facts alone. The prospect's name is fine here: this never reaches task instructions. */
export function rulesBrief(p: Prospect, repName: string, seller: string): Brief {
  const facts = Object.entries(p.facts).map(([k, v]) => `${k} ${v}`.toLowerCase());
  const all = facts.join(' ');
  const hooks: ResearchHook[] = [];
  const add = (hook: string, product: ProductLine) => hooks.length < 3 && hooks.push({ hook, product, via: 'crm' });
  if (/raise|raised|series|seed|funding/.test(all)) add('Recent raise: the board and new investors will expect D&O', 'd_and_o');
  if (/\bai\b|machine learning|llm|model/.test(all)) add('Ships AI: AI liability and E&O questions come up in contracts', 'ai_liability');
  if (/hiring|headcount|roles|employees/.test(all)) add('Growing team: EPLI as headcount climbs', 'epli');
  if (/enterprise|soc ?2|customers/.test(all)) add('Enterprise customers: E&O and cyber that contracts require', 'e_and_o');
  if (!hooks.length) add('Startups usually revisit D&O and cyber at their next raise', 'd_and_o');
  const first = p.name.split(/\s+/)[0] || 'there';
  return {
    summary: clip([p.title, p.company].filter(Boolean).join(' at ') + (facts.length ? `. ${Object.values(p.facts).slice(0, 3).join('; ')}` : ''), 400) || 'No CRM facts yet.',
    hooks,
    // Before the call the rep isn't known yet (the brief is shared by the team), so no name then.
    opener: clip(`${first}, ${repName ? `it's ${repName} at ${seller}` : `calling from ${seller}`}. Quick one: has anyone talked to you about D&O since the raise?`, 320),
    personaGuess: personaFromTitle(p.title),
    servedBy: 'rules',
  };
}
