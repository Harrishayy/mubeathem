import type { Brief, ProductLine, Prospect, ResearchBriefInput, ResearchHook } from '@cue/core';
import { personaFromTitle } from '../adapters/core';
import { clip, type Services } from '../services/context';

type Finding = ResearchBriefInput['findings'][number];

/**
 * Call start, never on the live path: Exa (when `EXA_API_KEY`) or CRM facts → `research_brief` →
 * `brief.ready`. Falls back to a rules brief from the CRM facts, labelled `servedBy: 'rules'`.
 */
export async function runBrief(s: Services, callId: string): Promise<void> {
  try {
    const view = s.store.view(callId);
    if (!view) return;
    const p = view.prospect;
    let findings: Finding[] = [];
    let via = 'crm';
    if (s.config.exaApiKey) {
      findings = await exaFindings(s, p);
      if (findings.length) via = 'exa';
    }
    if (!findings.length) findings = crmFindings(p);

    const r = await s.models.run(
      'research_brief',
      { prospect: { name: p.name, title: p.title, company: p.company, facts: p.facts }, findings, seller: s.config.seller },
      { callId, budgetMs: s.config.budgets.briefMs },
    );
    let brief: Brief;
    if (r.ok) {
      brief = {
        summary: clip(r.output.summary, 400),
        hooks: r.output.hooks.slice(0, 5).map((h) => ({ hook: clip(h.hook, 240), product: h.product, ...(h.source ? { source: clip(h.source, 400) } : {}), via })),
        opener: clip(r.output.opener, 320),
        personaGuess: r.output.persona_guess,
        servedBy: 'mubit',
      };
      s.telemetry.link(r.requestId, callId, 'research_brief');
    } else {
      brief = rulesBrief(p, view.rep.name, s.config.seller.company);
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

function crmFindings(p: Prospect): Finding[] {
  return Object.entries(p.facts)
    .slice(0, 8)
    .map(([k, v]) => ({ title: `CRM: ${k}`, text: v, url: null, publishedAt: null }));
}

interface ExaResult {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  highlights?: string[];
  text?: string;
}

/** Two Exa searches (company, person) with highlights; any failure yields no findings. */
async function exaFindings(s: Services, p: Prospect): Promise<Finding[]> {
  const search = async (query: string, category: 'company' | 'people'): Promise<Finding[]> => {
    try {
      const res = await s.fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': s.config.exaApiKey },
        body: JSON.stringify({ query, category, numResults: 3, contents: { highlights: true } }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { results?: ExaResult[] };
      return (json.results ?? []).map((r) => ({
        title: clip(r.title ?? '', 200),
        text: clip((r.highlights ?? []).join(' ') || r.text || '', 800),
        url: r.url ?? null,
        publishedAt: r.publishedDate ?? null,
      }));
    } catch {
      return [];
    }
  };
  const [company, person] = await Promise.all([
    p.company ? search(p.company, 'company') : Promise.resolve([]),
    p.name ? search(`${p.name} ${p.company}`.trim(), 'people') : Promise.resolve([]),
  ]);
  return [...company, ...person].filter((f) => f.text).slice(0, 6);
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
