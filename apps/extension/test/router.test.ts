import type { CueApi } from '@cue/client';
import { describe, expect, it, vi } from 'vitest';
import { route, type RouterDeps } from '../src/background/router';
import type { Session } from '../src/background/session';
import { initialState } from '../src/messages';

function deps() {
  const session = {
    snapshot: initialState(),
    start: vi.fn(async () => ({ ...initialState(), phase: 'live' })),
    end: vi.fn(async () => initialState()),
    typedTurn: vi.fn(() => 'turn_1'),
    action: vi.fn(async () => {}),
    feedback: vi.fn(async () => ({})),
    reset: vi.fn(),
    retryCapture: vi.fn(async () => {}),
    stopCapture: vi.fn(async () => {}),
    setMicSpeaker: vi.fn(async () => {}),
    pageContext: vi.fn(async () => {}),
    addTurn: vi.fn(),
    levels: vi.fn(),
    captureStatus: vi.fn(),
  };
  const api = {
    health: vi.fn(async () => ({ ok: true, mubit: { configured: false }, trellus: { configured: true } })),
    trellusStatus: vi.fn(async () => ({ configured: false })),
    contacts: vi.fn(async () => ({ items: [], total: 0 })),
    listCalls: vi.fn(async () => []),
    warmResearch: vi.fn(async () => ({ configured: true, providers: ['exa'] })),
    researchBrief: vi.fn(async () => ({ brief: { hooks: [] }, configured: true, providers: ['exa'] })),
  };
  const beside = { show: vi.fn(async () => 'split' as const), close: vi.fn(async () => {}) };
  const d: RouterDeps = { session: session as unknown as Session, api: () => api as unknown as CueApi, openPanel: vi.fn(async () => {}), beside };
  return { d, session, api, beside };
}

const tab = { tabId: 9, windowId: 2, frameId: 0 };

describe('background message routing', () => {
  it('ignores messages that are not ours', async () => {
    const { d } = deps();
    expect(await route(null, tab, d)).toBeUndefined();
    expect(await route({ target: 'offscreen', type: 'capture.stop' }, tab, d)).toBeUndefined();
    expect(await route({ type: 'something.else' }, tab, d)).toBeUndefined();
  });

  it('starts on the sender tab unless one is given', async () => {
    const { d, session } = deps();
    const prospect = { name: 'Maya', title: '', company: '', facts: {} };
    await route({ type: 'session.start', prospect }, tab, d);
    expect(session.start).toHaveBeenCalledWith({ prospect, tabId: 9, source: 'cue' });
    await route({ type: 'session.start', prospect, tabId: 3, source: 'trellus' }, tab, d);
    expect(session.start).toHaveBeenLastCalledWith({ prospect, tabId: 3, source: 'trellus' });
  });

  it('starts from a saved contact', async () => {
    const { d, session } = deps();
    const prospect = { name: '', title: '', company: '', facts: {} };
    await route({ type: 'session.start', prospect, contactId: 'contact_1' }, tab, d);
    expect(session.start).toHaveBeenCalledWith({ prospect, tabId: 9, source: 'cue', contactId: 'contact_1' });
  });

  it('searches saved contacts with a trimmed query and a bounded limit', async () => {
    const { d, api } = deps();
    expect(await route({ type: 'contacts.search', q: '  maya ' }, tab, d)).toEqual({ ok: true, data: { items: [], total: 0 } });
    expect(api.contacts).toHaveBeenLastCalledWith({ q: 'maya', limit: 20 });
    await route({ type: 'contacts.search', q: '   ', limit: 5000 }, tab, d);
    expect(api.contacts).toHaveBeenLastCalledWith({ limit: 100 });
  });

  it("reads a contact's previous calls and searches the team's calls", async () => {
    const { d, api } = deps();
    await route({ type: 'contacts.history', contactId: 'contact_9' }, tab, d);
    expect(api.listCalls).toHaveBeenLastCalledWith({ contactId: 'contact_9', limit: 3 });
    await route({ type: 'calls.search', q: '  Maya Chen ', limit: 900 }, tab, d);
    expect(api.listCalls).toHaveBeenLastCalledWith({ q: 'Maya Chen', limit: 200 });
    await route({ type: 'calls.search' }, tab, d);
    expect(api.listCalls).toHaveBeenLastCalledWith({ limit: 50 });
  });

  it('asks for the brief before the call, for a contact or a prospect', async () => {
    const { d, api } = deps();
    const prospect = { name: 'Maya', title: 'CEO', company: 'Lumen', facts: {} };
    expect(await route({ type: 'research.brief', prospect }, tab, d)).toMatchObject({ ok: true, data: { configured: true } });
    expect(api.researchBrief).toHaveBeenLastCalledWith({ prospect });
    await route({ type: 'research.brief', contactId: 'contact_1' }, tab, d);
    expect(api.researchBrief).toHaveBeenLastCalledWith({ contactId: 'contact_1' });
  });

  it("opens a source beside the call's tab, or the sender's before a call", async () => {
    const { d, session, beside } = deps();
    expect(await route({ type: 'beside.open', url: 'https://lumenlabs.ai/blog' }, tab, d)).toEqual({ ok: true, data: { mode: 'split' } });
    expect(beside.show).toHaveBeenLastCalledWith('https://lumenlabs.ai/blog', 9);
    session.snapshot = { ...initialState(), phase: 'live', tabId: 4 };
    await route({ type: 'beside.open', url: 'https://lumenlabs.ai/jobs' }, { tabId: null, windowId: null, frameId: 0 }, d);
    expect(beside.show).toHaveBeenLastCalledWith('https://lumenlabs.ai/jobs', 4);
    await route({ type: 'beside.close' }, tab, d);
    expect(beside.close).toHaveBeenCalled();
    expect(await route({ type: 'beside.open', url: 'x' }, tab, { ...d, beside: undefined })).toMatchObject({ ok: false });
  });

  it('tells a content script its tab id, and stamps the context with it', async () => {
    const { d, session } = deps();
    const res = await route({ type: 'page.context', context: { tabId: null, host: 'app.hubspot.com', prospect: null, trellus: { present: false, state: 'none' } } }, tab, d);
    expect(res).toEqual({ ok: true, data: { tabId: 9 } });
    expect(session.pageContext).toHaveBeenCalledWith(expect.objectContaining({ tabId: 9 }));
  });

  it('turns failures into a response instead of throwing', async () => {
    const { d, session } = deps();
    session.action.mockRejectedValueOnce(new Error('No call'));
    expect(await route({ type: 'session.action', suggestionId: 's', action: 'used' }, tab, d)).toEqual({ ok: false, error: 'No call' });
    session.typedTurn.mockReturnValueOnce(null as never);
    expect(await route({ type: 'session.turn', speaker: 'rep', text: 'x' }, tab, d)).toEqual({ ok: false, error: 'Start a call first' });
  });

  it('summarises health', async () => {
    const { d } = deps();
    expect(await route({ type: 'server.health' }, tab, d)).toEqual({ ok: true, data: { ok: true, mubit: false, trellus: true } });
  });
});
