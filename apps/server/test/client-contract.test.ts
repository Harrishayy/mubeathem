import { createCueApi } from '@cue/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { PROSPECT, REP, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

/** @cue/client against the real Hono app: every response must parse with the client's schemas. */
describe('@cue/client ↔ server contract', () => {
  it('every typed method round-trips', async () => {
    server = testServer({ config: { apiToken: 'tok' } });
    const fetch = ((url: string | URL | Request, init?: RequestInit) => server.app.request(String(url).replace('http://cue.test', ''), init)) as typeof globalThis.fetch;
    const api = createCueApi({ baseUrl: 'http://cue.test', token: 'tok', fetch });
    expect((await api.health()).ok).toBe(true);
    const call = await api.createCall({ source: 'practice', prospect: PROSPECT, rep: REP, practice: { mood: 'cold', objections: ['Just send me an email.'] } });
    const next = await api.practiceNext(call.id);
    expect(next.turn.speaker).toBe('prospect');
    await server.cue.idle();
    await api.addTurn(call.id, { speaker: 'rep', text: "Hi, it's Alex at Corgi." });
    await api.addTurn(call.id, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const view = await api.getCall(call.id);
    expect(view.current).not.toBeNull();
    await api.suggestionAction(call.id, view.current!.id, { action: 'thumbs_up' });
    await api.endCall(call.id, { outcome: 'follow_up' });
    await api.feedback(call.id, { outcome: 'follow_up', rating: 3 });
    await server.cue.idle();
    expect((await api.getRecord(call.id)).callId).toBe(call.id);
    expect((await api.listCalls(5))[0]!.id).toBe(call.id);
    const pb = await api.playbook();
    const cand = pb.lines.find((l) => l.status === 'candidate');
    if (cand) expect((await api.rejectLine(cand.id)).status).toBe('rejected');
    expect((await api.stats()).tasks).toHaveLength(6);
    expect((await api.trellusStatus()).source).toBe('native');
    expect((await api.trellusSync()).imported).toBe(0);
    expect((await api.trellusDispositions()).source).toBe('native');
    expect((await api.setTrellusDispositions({ overrides: { 'Meeting booked': 'follow_up' } })).overrides).toEqual({ 'Meeting booked': 'follow_up' });
    const stt = await api.sttToken().catch((e) => e);
    expect(stt.code).toBe('stt_not_configured');
    expect(stt.status).toBe(404);
    expect((await api.setTrellusKey({ apiKey: 'trl_x' })).configured).toBe(true);
  });
});
