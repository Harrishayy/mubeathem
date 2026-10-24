import { SynthBriefResponse } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { fakeMubit, json, post, testServer } from './helpers';

let server: CueServer;
afterEach(() => server?.close());

const BODY = {
  company: 'Lumen Labs',
  domain: 'lumenlabs.ai',
  sources: 'Company: Lumen Labs\nDomain: lumenlabs.ai\nPages on their own domain:\n1. Lumen Labs | AI document review — https://lumenlabs.ai/',
};

describe('POST /api/brief/synth', () => {
  it('runs synth_brief through the model runner and returns the parsed output', async () => {
    const mubit = fakeMubit();
    server = testServer({ mubit });
    const res = await post(server, '/api/brief/synth', BODY);
    expect(res.status).toBe(200);
    const body = SynthBriefResponse.parse(await res.json());
    expect(body.output.blurb).toContain('Lumen Labs');
    expect(body.output.policies[0]!.name).toBe('Technology E&O / Tech & AI Liability');
    expect(body.requestId).toMatch(/^mreq_fake_/);
    expect(mubit.calls).toHaveLength(1);
    expect(mubit.calls[0]).toMatchObject({ task: 'synth_brief', sessionId: 'brief_lumenlabs.ai', input: BODY });
    const stats = await json<{ tasks: { task: string; calls: number }[] }>(server.app.request('/api/stats'));
    expect(stats.tasks.find((t) => t.task === 'synth_brief')?.calls).toBe(1);
  });

  it('wants the token when one is set', async () => {
    server = testServer({ config: { apiToken: 'secret' } });
    expect((await post(server, '/api/brief/synth', BODY)).status).toBe(401);
    expect((await post(server, '/api/brief/synth', BODY, { 'x-cue-token': 'secret' })).status).toBe(200);
  });

  it('rejects a body that is not the synth_brief input', async () => {
    server = testServer();
    const res = await post(server, '/api/brief/synth', { company: 'Lumen Labs' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_request');
  });

  it('answers a JSON error, not a throw, when the model fails or is not configured', async () => {
    server = testServer({ mubit: fakeMubit({ fail: { synth_brief: 'http' } }) });
    const bad = await post(server, '/api/brief/synth', BODY);
    expect(bad.status).toBe(502);
    expect((await bad.json()).error.code).toBe('http');
    server.close();

    server = testServer({ mubit: fakeMubit({ fail: { synth_brief: 'timeout' } }) });
    const slow = await post(server, '/api/brief/synth', BODY);
    expect(slow.status).toBe(504);
    server.close();

    server = testServer({ mubit: null });
    const none = await post(server, '/api/brief/synth', BODY);
    expect(none.status).toBe(503);
    expect((await none.json()).error.code).toBe('not_configured');
  });
});
