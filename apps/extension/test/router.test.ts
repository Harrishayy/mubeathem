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
    setTrellusKey: vi.fn(async () => ({ configured: true, source: 'trellus' })),
    trellusDispositions: vi.fn(async () => ({ source: 'trellus', vocabulary: ['Booked'], learned: [], map: {}, overrides: {}, unmapped: ['Booked'], error: null })),
    setTrellusDispositions: vi.fn(async (req: unknown) => ({ source: 'trellus', overrides: (req as { overrides: unknown }).overrides })),
    contacts: vi.fn(async () => ({ items: [], total: 0 })),
    createContact: vi.fn(async (c: unknown) => ({ id: 'contact_9', ...(c as object) })),
    listCalls: vi.fn(async () => []),
    warmResearch: vi.fn(async () => ({ configured: true, providers: ['exa'] })),
  };
  const d: RouterDeps = { session: session as unknown as Session, api: () => api as unknown as CueApi, openPanel: vi.fn(async () => {}) };
  return { d, session, api };
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

  it('saves a contact and reads its previous calls', async () => {
    const { d, api } = deps();
    const contact = { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', phone: '+14155550142' };
    expect(await route({ type: 'contacts.create', contact }, tab, d)).toMatchObject({ ok: true, data: { id: 'contact_9', name: 'Maya Chen' } });
    expect(api.createContact).toHaveBeenCalledWith(contact);
    await route({ type: 'contacts.history', contactId: 'contact_9' }, tab, d);
    expect(api.listCalls).toHaveBeenLastCalledWith({ contactId: 'contact_9', limit: 3 });
  });

  it('warms research for a contact or a page prospect', async () => {
    const { d, api } = deps();
    expect(await route({ type: 'research.warm', contactId: 'contact_1' }, tab, d)).toEqual({ ok: true, data: { configured: true, providers: ['exa'] } });
    expect(api.warmResearch).toHaveBeenLastCalledWith({ contactId: 'contact_1' });
    const prospect = { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', facts: {} };
    await route({ type: 'research.warm', prospect }, tab, d);
    expect(api.warmResearch).toHaveBeenLastCalledWith({ prospect });
    api.warmResearch.mockRejectedValueOnce(new Error('offline'));
    expect(await route({ type: 'research.warm', contactId: 'x' }, tab, d)).toEqual({ ok: false, error: 'offline' });
  });

  it('routes offscreen capture events to the session', async () => {
    const { d, session } = deps();
    const turn = { id: 't1', speaker: 'prospect', text: 'hi', final: true, tMs: 10, via: 'deepgram' };
    await route({ type: 'capture.turn', turn }, tab, d);
    await route({ type: 'capture.levels', levels: { prospect: 0.4, rep: 0 } }, tab, d);
    await route({ type: 'capture.status', side: 'mic', status: { state: 'denied' } }, tab, d);
    expect(session.addTurn).toHaveBeenCalledWith(turn);
    expect(session.levels).toHaveBeenCalledWith({ prospect: 0.4, rep: 0 });
    expect(session.captureStatus).toHaveBeenCalledWith('mic', { state: 'denied' });
  });

  it('starts and stops listening on request', async () => {
    const { d, session } = deps();
    expect(await route({ type: 'capture.stop' }, tab, d)).toEqual({ ok: true, data: null });
    expect(session.stopCapture).toHaveBeenCalled();
    await route({ type: 'capture.retry' }, tab, d);
    expect(session.retryCapture).toHaveBeenCalled();
  });

  it('tells a content script its tab id, and stamps the context with it', async () => {
    const { d, session } = deps();
    const res = await route({ type: 'page.context', context: { tabId: null, host: 'app.hubspot.com', prospect: null, trellus: { present: false, state: 'none' } } }, tab, d);
    expect(res).toEqual({ ok: true, data: { tabId: 9 } });
    expect(session.pageContext).toHaveBeenCalledWith(expect.objectContaining({ tabId: 9 }));
  });

  it('forwards the Trellus key to the server and returns only the status', async () => {
    const { d, api } = deps();
    const res = await route({ type: 'trellus.setKey', apiKey: 'tk_secret', teamId: 'team_1' }, tab, d);
    expect(api.setTrellusKey).toHaveBeenCalledWith({ apiKey: 'tk_secret', teamId: 'team_1' });
    expect(JSON.stringify(res)).not.toContain('tk_secret');
  });

  it('turns failures into a response instead of throwing', async () => {
    const { d, session } = deps();
    session.action.mockRejectedValueOnce(new Error('No call'));
    expect(await route({ type: 'session.action', suggestionId: 's', action: 'used' }, tab, d)).toEqual({ ok: false, error: 'No call' });
    session.typedTurn.mockReturnValueOnce(null as never);
    expect(await route({ type: 'session.turn', speaker: 'rep', text: 'x' }, tab, d)).toEqual({ ok: false, error: 'Start a call first' });
  });

  it('reads and replaces the disposition overrides on the server', async () => {
    const { d, api } = deps();
    expect(await route({ type: 'trellus.dispositions' }, tab, d)).toMatchObject({ ok: true, data: { unmapped: ['Booked'] } });
    await route({ type: 'trellus.setDispositions', overrides: { 'Booked - meeting': 'meeting_booked' } }, tab, d);
    expect(api.setTrellusDispositions).toHaveBeenCalledWith({ overrides: { 'Booked - meeting': 'meeting_booked' } });
  });

  it('summarises health', async () => {
    const { d } = deps();
    expect(await route({ type: 'server.health' }, tab, d)).toEqual({ ok: true, data: { ok: true, mubit: false, trellus: true } });
  });
});
