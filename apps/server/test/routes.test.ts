import { ApiError, CallRecord, CallSummary, CallView, HealthResponse, PlaybookLine, PlaybookResponse, StatsResponse, TrellusStatusResponse } from '@cue/core';
import { reduceCall } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { createCall, json, post, testServer, types } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

describe('call lifecycle over HTTP', () => {
  it('create → turns → card with evidence → action → end → feedback → review → playbook stats changed', async () => {
    server = testServer();
    const created = CallView.parse(await json(post(server, '/api/calls', { prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', facts: {} }, rep: { id: 'rep_1', name: 'Alex' } })));
    const id = created.id;
    expect(created.status).toBe('live');

    expect((await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: "Hi Maya, it's Alex at Corgi." })).status).toBe(202);
    const r = await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "...what's this regarding?" });
    expect(r.status).toBe(202);
    expect((await json(r)).turnId).toMatch(/^turn_/);
    await server.cue.idle();

    let view = CallView.parse(await json(server.app.request(`/api/calls/${id}`)));
    expect(view.situation?.moment).toBe('whats_this_regarding');
    const card = view.current!;
    expect(card.kind).toBe('line');
    expect(card.servedBy).toBe('mubit');
    expect(card.evidence.text.length).toBeGreaterThan(0);
    expect(card.mubitRequestIds.length).toBeGreaterThanOrEqual(2);
    expect(card.latencyMs).toBeGreaterThanOrEqual(0);

    expect((await post(server, `/api/calls/${id}/suggestions/${card.id}/action`, { action: 'used' })).status).toBe(204);
    const before = PlaybookLine.parse(server.cue.s.playbook.get(card.lineId)).stats['*'] ?? { shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 };

    await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: card.say });
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'Okay, go on, how much would that cost?' });
    await server.cue.idle();

    view = CallView.parse(await json(post(server, `/api/calls/${id}/end`, { outcome: 'meeting_booked' })));
    expect(view.status).toBe('ended');
    expect(view.outcome?.outcome).toBe('meeting_booked');

    view = CallView.parse(await json(post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked', rating: 5, attitude: 'curious', betterLine: 'Who re-shops your cover after a raise?' })));
    expect(view.feedback?.rating).toBe(5);
    await server.cue.idle();

    view = CallView.parse(await json(server.app.request(`/api/calls/${id}`)));
    expect(view.status).toBe('reviewed');
    expect(view.review?.outcome).toBe('meeting_booked');
    const events = server.cue.s.store.list(id);
    expect(types(events)).toContain('review.completed');
    expect(types(events)).toContain('playbook.updated');

    const after = server.cue.s.playbook.get(card.lineId)!.stats['*']!;
    expect(after.shown).toBeGreaterThan(before.shown);
    expect(after.used).toBeGreaterThan(before.used);
    expect(after.booked).toBeGreaterThan(before.booked);

    const pb = PlaybookResponse.parse(await json(server.app.request('/api/playbook')));
    expect(pb.lines.some((l) => l.status === 'candidate')).toBe(true);
    expect(pb.leaderboard.length).toBeGreaterThan(0);

    const record = CallRecord.parse(await json(server.app.request(`/api/calls/${id}/record`)));
    expect(record.suggestions.length).toBeGreaterThan(0);
    const list = CallSummary.array().parse(await json(server.app.request('/api/calls?limit=5')));
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.used).toBeGreaterThan(0);

    const stats = StatsResponse.parse(await json(server.app.request('/api/stats')));
    expect(stats.tasks.find((t) => t.task === 'read_moment')!.calls).toBeGreaterThan(0);
    expect(stats.tasks.find((t) => t.task === 'review_call')!.ok).toBe(1);
    expect(stats.calls.booked).toBe(1);

    const exp = await server.app.request('/api/export.jsonl');
    const lines = (await exp.text()).trim().split('\n');
    expect(CallRecord.parse(JSON.parse(lines[0]!)).callId).toBe(id);
  });

  it('replay: reduceCall(store.list(id)) equals GET /api/calls/:id', async () => {
    server = testServer();
    const id = await createCall(server);
    for (const text of ['Hello?', "What's this regarding?", 'We already have a broker.']) {
      await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text });
      await server.cue.idle();
      await post(server, `/api/calls/${id}/turns`, { speaker: 'rep', text: 'Sure, quick one.' });
    }
    await server.cue.idle();
    const served = await json(server.app.request(`/api/calls/${id}`));
    expect(served).toEqual(JSON.parse(JSON.stringify(reduceCall(server.cue.s.store.list(id)))));
  });

  it('dedupes a replayed turn by id and ignores interim after final', async () => {
    server = testServer();
    const id = await createCall(server);
    const turn = { id: 'turn_client_1', speaker: 'prospect', text: "What's this regarding?" };
    await post(server, `/api/calls/${id}/turns`, { ...turn, final: false, text: "What's this" });
    await post(server, `/api/calls/${id}/turns`, turn);
    const dup = await json(post(server, `/api/calls/${id}/turns`, turn));
    expect(dup.duplicate).toBe(true);
    await post(server, `/api/calls/${id}/turns`, { ...turn, final: false });
    await server.cue.idle();
    const view = CallView.parse(await json(server.app.request(`/api/calls/${id}`)));
    expect(view.turns.filter((t) => t.id === 'turn_client_1')).toHaveLength(1);
    expect(server.cue.s.store.list(id).filter((e) => e.type === 'situation.read')).toHaveLength(1);
  });
});

describe('validation and errors', () => {
  it('returns ApiError 400 for bad bodies and bad JSON, 404 for unknown calls/routes, 409 after end', async () => {
    server = testServer();
    const bad = await post(server, '/api/calls', { prospect: { name: 1 } });
    expect(bad.status).toBe(400);
    const body = ApiError.parse(await json(bad));
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details).toBeTruthy();

    const notJson = await server.app.request('/api/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(notJson.status).toBe(400);
    expect(ApiError.parse(await json(notJson)).error.code).toBe('invalid_json');

    expect(ApiError.parse(await json(server.app.request('/api/calls/call_missing'))).error.code).toBe('not_found');
    expect((await server.app.request('/api/nope')).status).toBe(404);

    const id = await createCall(server);
    expect((await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: '' })).status).toBe(400);
    expect((await post(server, `/api/calls/${id}/suggestions/sug_nope/action`, { action: 'used' })).status).toBe(404);
    await post(server, `/api/calls/${id}/end`, {});
    const late = await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'hello?' });
    expect(late.status).toBe(409);
    expect(ApiError.parse(await json(late)).error.code).toBe('call_ended');
  });

  it('rejects bodies over 64 KB with 413', async () => {
    server = testServer();
    const id = await createCall(server);
    const res = await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'x'.repeat(70_000) });
    expect(res.status).toBe(413);
    expect(ApiError.parse(await json(res)).error.code).toBe('payload_too_large');
  });

  it('approve refuses a line that failed policy; reject works', async () => {
    server = testServer();
    const line = server.cue.s.playbook.all()[0]!;
    server.cue.s.playbook.save([{ ...line, id: 'line_bad', status: 'candidate', policy: { verdict: 'violation' } }, { ...line, id: 'line_ok', status: 'candidate', stats: {} }]);
    expect((await post(server, '/api/playbook/lines/line_bad/approve')).status).toBe(409);
    expect(PlaybookLine.parse(await json(post(server, '/api/playbook/lines/line_ok/approve'))).status).toBe('active');
    expect(PlaybookLine.parse(await json(post(server, '/api/playbook/lines/line_bad/reject'))).status).toBe('rejected');
    expect((await post(server, '/api/playbook/lines/line_zzz/approve')).status).toBe(404);
  });
});

describe('auth and CORS', () => {
  it('requires x-cue-token on /api when configured; /health stays open; stream accepts ?token=', async () => {
    server = testServer({ config: { apiToken: 'secret-token' } });
    expect((await server.app.request('/health')).status).toBe(200);
    const no = await server.app.request('/api/calls');
    expect(no.status).toBe(401);
    expect(ApiError.parse(await json(no)).error.code).toBe('unauthorized');
    expect((await server.app.request('/api/calls', { headers: { 'x-cue-token': 'wrong' } })).status).toBe(401);
    expect((await server.app.request('/api/calls', { headers: { 'x-cue-token': 'secret-token' } })).status).toBe(200);
    expect((await server.app.request('/api/calls?token=secret-token')).status).toBe(401);
    const id = await json(post(server, '/api/calls', { prospect: { name: 'A', title: 'CEO', company: 'B', facts: {} }, rep: { id: 'r', name: 'R' } }, { 'x-cue-token': 'secret-token' }));
    const ac = new AbortController();
    const stream = await server.app.request(`/api/calls/${id.id}/stream?token=secret-token`, { signal: ac.signal });
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    ac.abort();
  });

  it('allows configured origins incl. chrome-extension://* and refuses others', async () => {
    server = testServer({ config: { allowedOrigins: ['http://localhost:5173', 'chrome-extension://*'] } });
    const ok = await server.app.request('/api/calls', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abcdef', 'access-control-request-method': 'POST' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('chrome-extension://abcdef');
    const web = await server.app.request('/health', { headers: { origin: 'http://localhost:5173' } });
    expect(web.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const evil = await server.app.request('/health', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('health and trellus settings', () => {
  it('/health is truthful with and without a Mubit client', async () => {
    server = testServer({ mubit: null });
    const h = HealthResponse.parse(await json(server.app.request('/health')));
    expect(h.mubit.configured).toBe(false);
    expect(h.mubit.reachable).toBeNull();
    expect(h.trellus.configured).toBe(false);
    await server.close();
    server = testServer();
    const h2 = HealthResponse.parse(await json(server.app.request('/health')));
    expect(h2.mubit.configured).toBe(true);
  });

  it('stores the Trellus key server-side and never echoes it', async () => {
    server = testServer();
    expect(TrellusStatusResponse.parse(await json(server.app.request('/api/trellus/status'))).source).toBe('native');
    const res = await post(server, '/api/trellus/key', { apiKey: 'trl_super_secret_key', teamId: 'team_1' });
    const text = await res.text();
    expect(text).not.toContain('trl_super_secret_key');
    const st = TrellusStatusResponse.parse(JSON.parse(text));
    expect(st.configured).toBe(true);
    expect(st.source).toBe('trellus');
    expect(st.teamId).toBe('team_1');
  });
});
