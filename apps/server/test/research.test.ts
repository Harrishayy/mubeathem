import { CallView } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { cited } from '../src/pipeline/brief';
import { merge, type Finding } from '../src/pipeline/research';
import { json, post, PROSPECT, REP, testServer } from './helpers';

let server: CueServer;
afterEach(() => server?.close());

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Answers Exa and Valyu like the real APIs; records every request. */
function fakeWeb(opts: { exaDown?: boolean; valyuDown?: boolean } = {}) {
  const seen: Seen[] = [];
  const fetch: typeof globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    seen.push({ url: u, headers: init?.headers as Record<string, string>, body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://api.exa.ai/')) {
      if (opts.exaDown) return new Response('{}', { status: 500 });
      const cat = String(body.category);
      return ok({
        results: [
          { title: `Lumen Labs ${cat}`, url: `https://lumenlabs.ai/${cat}`, publishedDate: '2026-09-01', highlights: [`Lumen ${cat} highlight`] },
          { title: 'Shared story', url: 'https://www.techcrunch.com/lumen-raise/', highlights: ['Lumen raised a Series A'] },
        ],
      });
    }
    if (u.startsWith('https://api.valyu.ai/')) {
      if (opts.valyuDown) throw new Error('ECONNRESET');
      return ok({
        results: [
          { title: 'Lumen hires a CRO', url: 'https://news.example.com/lumen-cro', content: 'Lumen Labs hired a Chief Revenue Officer.', publication_date: '2026-10-02', relevance_score: 0.8 },
          { title: 'Same story again', url: 'https://techcrunch.com/lumen-raise', content: 'Duplicate of the raise.' },
        ],
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

const env = { EXA_API_KEY: 'exa_test', VALYU_API_KEY: 'valyu_test' };

describe('pre-call research', () => {
  it('asks Exa and Valyu in parallel with the right auth and body, merges, de-dupes and cites sources', async () => {
    const web = fakeWeb();
    server = testServer({ env, fetch: web.fetch });
    const v = await json(post(server, '/api/calls', { prospect: PROSPECT, rep: REP }));
    await server.cue.idle();
    const view = CallView.parse(await json(server.app.request(`/api/calls/${v.id}`)));

    const exa = web.seen.filter((r) => r.url === 'https://api.exa.ai/search');
    const valyu = web.seen.filter((r) => r.url === 'https://api.valyu.ai/v1/search');
    expect(exa.map((r) => r.body.category).sort()).toEqual(['company', 'news', 'people']);
    expect(exa[0]!.headers['x-api-key']).toBe('exa_test');
    expect(valyu).toHaveLength(2);
    expect(valyu[0]!.headers['X-API-Key']).toBe('valyu_test');
    expect(Object.keys(valyu[0]!.body).sort()).toEqual(['fast_mode', 'max_num_results', 'query', 'relevance_threshold', 'response_length', 'search_type']);

    const sources = view.brief?.sources ?? [];
    expect(sources.some((s) => s.via === 'exa')).toBe(true);
    expect(sources.some((s) => s.via === 'valyu')).toBe(true);
    expect(sources.filter((s) => s.url?.includes('techcrunch.com/lumen-raise'))).toHaveLength(1);
    expect(sources.some((s) => s.via === 'crm')).toBe(true);
  });

  it('one provider down still briefs from the other; both down falls back to CRM facts', async () => {
    const half = fakeWeb({ valyuDown: true });
    server = testServer({ env, fetch: half.fetch });
    let id = (await json(post(server, '/api/calls', { prospect: PROSPECT, rep: REP }))).id;
    await server.cue.idle();
    let view = CallView.parse(await json(server.app.request(`/api/calls/${id}`)));
    expect(view.brief?.sources?.some((s) => s.via === 'exa')).toBe(true);
    expect(view.brief?.sources?.some((s) => s.via === 'valyu')).toBe(false);
    await server.close();

    server = testServer({ env, fetch: fakeWeb({ exaDown: true, valyuDown: true }).fetch });
    id = (await json(post(server, '/api/calls', { prospect: PROSPECT, rep: REP }))).id;
    await server.cue.idle();
    view = CallView.parse(await json(server.app.request(`/api/calls/${id}`)));
    expect(view.brief).not.toBeNull();
    expect(view.brief!.sources!.every((s) => s.via === 'crm')).toBe(true);
  });

  it('warming a contact caches findings so the call itself makes no web requests', async () => {
    const web = fakeWeb();
    server = testServer({ env, fetch: web.fetch });
    const ct = await json(post(server, '/api/contacts', { name: PROSPECT.name, title: PROSPECT.title, company: PROSPECT.company }));
    const warm = await post(server, '/api/research/warm', { contactId: ct.id });
    expect(warm.status).toBe(202);
    expect(await warm.json()).toEqual({ configured: true, providers: ['exa', 'valyu'] });
    await server.cue.idle();
    const before = web.seen.length;
    expect(before).toBe(5);
    await post(server, '/api/calls', { contactId: ct.id, prospect: {}, rep: REP });
    await server.cue.idle();
    expect(web.seen.length).toBe(before);
    expect((await post(server, '/api/research/warm', {})).status).toBe(400);
  });

  it('no keys: no web requests at all', async () => {
    const web = fakeWeb();
    server = testServer({ fetch: web.fetch });
    await post(server, '/api/calls', { prospect: PROSPECT, rep: REP });
    await server.cue.idle();
    expect(web.seen.filter((r) => r.url.includes('exa.ai') || r.url.includes('valyu.ai'))).toHaveLength(0);
  });

  it('merge alternates providers and drops the same page; cited matches url, title or host', () => {
    const f = (via: 'exa' | 'valyu', n: number, url: string): Finding => ({ title: `${via} ${n}`, text: 't', url, publishedAt: null, via });
    const out = merge([f('exa', 1, 'https://a.com/x'), f('exa', 2, 'https://b.com/')], [f('valyu', 1, 'https://www.a.com/x/'), f('valyu', 2, 'https://c.com')]);
    expect(out.map((x) => x.title)).toEqual(['exa 1', 'exa 2', 'valyu 2']);
    expect(cited(out, 'per c.com reporting')?.title).toBe('valyu 2');
    expect(cited(out, 'exa 2')?.via).toBe('exa');
    expect(cited(out, 'nothing')).toBeNull();
  });
});

describe('research helpers', () => {
  it('tidies markdown snippets and reads the work domain from an email', async () => {
    const { tidy, companyDomain } = await import('../src/pipeline/research');
    expect(tidy('# Ramp\n\nRamp is a   company.')).toBe('Ramp Ramp is a company.');
    expect(companyDomain({ ...PROSPECT, email: 'eric@ramp.com' })).toBe('ramp.com');
    expect(companyDomain({ ...PROSPECT, email: 'eric@gmail.com' })).toBeNull();
    expect(companyDomain(PROSPECT)).toBeNull();
  });
});
