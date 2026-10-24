import type { Brief, BriefSource, ProductLine, Prospect, ResearchHook } from '@cue/core';
import { personaFromTitle } from '../adapters/core';
import { clip, type Services } from '../services/context';
import { crmFindings, research, type Finding } from './research';

/**
 * Call start, never on the live path: web research (Exa and Valyu in parallel, when keyed) plus CRM
 * facts → `research_brief` → `brief.ready`, with every hook citing where it came from. Falls back to
 * a rules brief from the CRM facts, labelled `servedBy: 'rules'`.
 */
export async function runBrief(s: Services, callId: string): Promise<void> {
  try {
    const view = s.store.view(callId);
    if (!view) return;
    const p = view.prospect;
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
      { callId, budgetMs: s.config.budgets.briefMs },
    );
    let brief: Brief;
    if (r.ok) {
      brief = {
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
      };
      s.telemetry.link(r.requestId, callId, 'research_brief');
    } else {
      brief = { ...rulesBrief(p, view.rep.name, s.config.seller.company), sources };
      if (r.code !== 'not_configured')
        s.store.append({ type: 'pipeline.error', callId, stage: 'research_brief', message: clip(`${r.code}: ${r.message}; served by rules`, 480), retryable: r.retryable });
    }
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
    opener: clip(`${first}, it's ${repName || 'me'} at ${seller}. Quick one: has anyone talked to you about D&O since the raise?`, 320),
    personaGuess: personaFromTitle(p.title),
    servedBy: 'rules',
  };
}
