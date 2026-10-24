import type { Prospect, ResearchBriefInput } from '@cue/core';
import { clip, type Services } from '../services/context';

export type Finding = ResearchBriefInput['findings'][number] & { via: ResearchVia };
export type ResearchVia = 'exa' | 'valyu' | 'crm';

const MAX_FINDINGS = 8;

interface CacheEntry {
  at: number;
  findings: Promise<Finding[]>;
}

/** Findings per person, shared by the pre-call warm-up and the brief, so a warmed call starts instantly. */
const cache = new WeakMap<Services, Map<string, CacheEntry>>();

/** One person: research and the brief are cached under this key. */
export const researchKey = (p: Prospect) => [p.name, p.company].map((x) => x.trim().toLowerCase()).join('|');
const keyOf = researchKey;

export function researchConfigured(s: Services): boolean {
  return !!(s.config.exaApiKey || s.config.valyuApiKey);
}

/**
 * Web research on the person and their company: Exa and Valyu in parallel, merged, de-duplicated by
 * URL and capped. Any provider failing just contributes nothing. Never throws; CRM facts are the
 * caller's fallback. Results are cached per person for `research.cacheMinutes`.
 */
export function research(s: Services, p: Prospect): Promise<Finding[]> {
  if (!researchConfigured(s) || (!p.company.trim() && !p.name.trim())) return Promise.resolve([]);
  let byKey = cache.get(s);
  if (!byKey) cache.set(s, (byKey = new Map()));
  const key = keyOf(p);
  const ttl = s.config.research.cacheMinutes * 60_000;
  const hit = byKey.get(key);
  if (hit && ttl > 0 && s.now() - hit.at < ttl) return hit.findings;
  const findings = Promise.all([s.config.exaApiKey ? exaFindings(s, p) : [], s.config.valyuApiKey ? valyuFindings(s, p) : []]).then(([exa, valyu]) => merge(exa, valyu));
  if (ttl > 0) {
    byKey.set(key, { at: s.now(), findings });
    // an empty answer (both providers down) shouldn't stick for hours
    void findings.then((f) => !f.length && byKey.get(key)?.findings === findings && byKey.delete(key));
    while (byKey.size > 500) byKey.delete(byKey.keys().next().value as string);
  }
  return findings;
}

/** Alternates providers so neither crowds the other out, dropping repeats of the same page. */
export function merge(...lists: Finding[][]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < MAX_FINDINGS; i++) {
    for (const list of lists) {
      const f = list[i];
      if (!f || !f.text.trim()) continue;
      const k = f.url ? normUrl(f.url) : `t:${f.title.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
      if (out.length >= MAX_FINDINGS) break;
    }
  }
  return out;
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

async function post(s: Services, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  try {
    const res = await s.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(s.config.research.timeoutMs),
    });
    if (!res.ok) {
      s.log.warn('research provider failed', { url, status: res.status });
      return null;
    }
    return await res.json();
  } catch (e) {
    s.log.warn('research provider failed', { url, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

interface ExaResult {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  highlights?: string[];
  text?: string;
}

/** Exa: the company, its recent news, and the person, with highlights. */
async function exaFindings(s: Services, p: Prospect): Promise<Finding[]> {
  const search = async (query: string, category: 'company' | 'people' | 'news', extra: Record<string, unknown> = {}): Promise<Finding[]> => {
    const json = (await post(s, 'https://api.exa.ai/search', { 'x-api-key': s.config.exaApiKey }, { query, category, type: 'auto', numResults: 3, contents: { highlights: true }, ...extra })) as {
      results?: ExaResult[];
    } | null;
    return (json?.results ?? []).map((r) => ({
      title: clip(r.title ?? '', 200),
      text: clip(tidy((r.highlights ?? []).join(' … ') || r.text || ''), 800),
      url: r.url ?? null,
      publishedAt: r.publishedDate ?? null,
      via: 'exa' as const,
    }));
  };
  const since = new Date(s.now() - 180 * 86_400_000).toISOString();
  const domain = companyDomain(p);
  const [company, news, person] = await Promise.all([
    p.company ? search(domain ? `${p.company} (${domain})` : p.company, 'company', domain ? { includeDomains: [domain] } : {}) : [],
    p.company ? search(`${p.company} news`, 'news', { startPublishedDate: since }) : [],
    p.name ? search(`${p.name} ${p.title} ${p.company}`.replace(/\s+/g, ' ').trim(), 'people') : [],
  ]);
  return merge(news, company, person);
}

interface ValyuResult {
  title?: string | null;
  url?: string | null;
  content?: unknown;
  description?: string | null;
  publication_date?: string | null;
  relevance_score?: number;
}

/** Valyu: one news-and-web search on the company, one on the person. */
async function valyuFindings(s: Services, p: Prospect): Promise<Finding[]> {
  const search = async (query: string, searchType: 'all' | 'web' | 'news'): Promise<Finding[]> => {
    const json = (await post(
      s,
      'https://api.valyu.ai/v1/search',
      { 'X-API-Key': s.config.valyuApiKey },
      { query, search_type: searchType, max_num_results: 4, relevance_threshold: 0.5, fast_mode: true, response_length: 'short' },
    )) as { results?: ValyuResult[] } | null;
    return (json?.results ?? []).map((r) => ({
      title: clip(r.title ?? '', 200),
      text: clip(tidy(typeof r.content === 'string' ? r.content : r.description || (r.content ? JSON.stringify(r.content) : '')), 800),
      url: r.url ?? null,
      publishedAt: r.publication_date ?? null,
      via: 'valyu' as const,
    }));
  };
  const [company, person] = await Promise.all([
    p.company ? search(`${p.company} company news funding hiring`, 'all') : [],
    p.name ? search(`${p.name} ${p.title} ${p.company}`.replace(/\s+/g, ' ').trim(), 'web') : [],
  ]);
  return merge(company, person);
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|mail)\./i;

/** The company's own domain from the contact's work email, when it has one. */
export function companyDomain(p: Prospect): string | null {
  const d = p.email?.split('@')[1]?.trim().toLowerCase();
  return d && d.includes('.') && !FREE_MAIL.test(d) ? d : null;
}

/** Search snippets arrive as markdown: drop heading marks and collapse whitespace. */
export function tidy(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** CRM facts as findings, when there's no web research. */
export function crmFindings(p: Prospect): Finding[] {
  return Object.entries(p.facts)
    .slice(0, 8)
    .map(([k, v]) => ({ title: `CRM: ${k}`, text: v, url: null, publishedAt: null, via: 'crm' as const }));
}
