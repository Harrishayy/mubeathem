import { CueApiError } from '@cue/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApi } from '../src/state/api';
import { updateSettings } from '../src/state/settings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api client as the app uses it', () => {
  it('follows the server URL and token from settings', async () => {
    const fetch = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetch);
    updateSettings({ serverUrl: 'http://a.test', token: 't1' });
    await getApi().listCalls(5);
    updateSettings({ serverUrl: 'http://b.test', token: '' });
    await getApi().listCalls(5);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('http://a.test/api/calls?limit=5');
    expect((calls[0]![1].headers as Record<string, string>)['x-cue-token']).toBe('t1');
    expect(calls[1]![0]).toBe('http://b.test/api/calls?limit=5');
  });

  it('maps ApiError bodies, contract mismatches and network failures', async () => {
    updateSettings({ serverUrl: 'http://a.test', token: '' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'not_found', message: 'No call x' } }, 404)));
    await expect(getApi().getCall('x')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => json({ nope: true })));
    await expect(getApi().getCall('x')).rejects.toMatchObject({ code: 'bad_response' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await getApi().health().catch((e) => e);
    expect(err).toBeInstanceOf(CueApiError);
    expect(err.retryable).toBe(true);
  });
});
