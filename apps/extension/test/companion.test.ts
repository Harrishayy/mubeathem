import { demoEvents, reduceCall, type CallEvent, type CallSummary, type CallView } from '@cue/core';
import { describe, expect, it, vi } from 'vitest';
import { Beside, besideUrl, type BesideDeps } from '../src/background/beside';
import { badgeFor, outcomeNote, xml } from '../src/background/surfaces';
import { initialState } from '../src/messages';
import { defaultSettings, publicSettings, webPatch } from '../src/settings';
import { bestHours, domainOf, hourWords, momentStrip, pastCallsFor, prospectKey, talkShare, transcriptRows } from '../src/ui/companion';

/** The demo call replayed up to (and including) the first event that matches. */
function viewAt(pred: (e: CallEvent) => boolean = () => false): CallView {
  const events = demoEvents({ variant: 'cold' });
  const i = events.findIndex(pred);
  return reduceCall(events.slice(0, i < 0 ? events.length : i + 1));
}
const live = () => viewAt((e) => e.type === 'suggestion.shown' && e.suggestion.kind === 'line' && e.suggestion.situation.moment === 'objection_broker');

describe('the transcript, read for the rep', () => {
  it("puts the moment Cue read above each prospect turn it answered, and ticks the rep's turn after a used line", () => {
    const base = live();
    const answered = base.history[0]!;
    const view: CallView = { ...base, history: base.history.map((h, i) => (i === 0 ? { ...h, action: 'used' } : h)) };
    const rows = transcriptRows(view);
    const at = rows.findIndex((r) => r.kind === 'turn' && r.turn.id === answered.suggestion.turnId);
    expect(rows[at - 1]).toMatchObject({ kind: 'moment' });
    const nextRep = rows.slice(at + 1).find((r) => r.kind === 'turn' && r.turn.speaker === 'rep');
    expect(nextRep).toMatchObject({ usedLine: true });
    expect(rows.filter((r) => r.kind === 'turn' && r.usedLine)).toHaveLength(1);
    const latest = rows.filter((r) => r.kind === 'turn' && r.latest);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ turn: { speaker: 'prospect' } });
  });

  it("shows the prospect's words while they're still speaking, last", () => {
    const base = live();
    const interim = { id: 'turn_live', speaker: 'prospect' as const, text: 'I think we already have', tMs: 99_000, final: false, via: 'webspeech' };
    const rows = transcriptRows({ ...base, turns: [...base.turns, interim] });
    expect(rows.at(-1)).toMatchObject({ kind: 'turn', turn: { id: 'turn_live', final: false }, latest: true });
  });

  it('works out the talk share, the moments in order and the domain of a source', () => {
    const v = viewAt();
    const share = talkShare(v)!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(talkShare({ ...v, turns: [] })).toBeNull();
    const strip = momentStrip(v);
    expect(strip.length).toBeGreaterThan(1);
    expect(strip.every((m, i) => i === 0 || strip[i - 1]!.moment !== m.moment)).toBe(true);
    expect(domainOf('https://www.lumenlabs.ai/blog/series-a')).toBe('lumenlabs.ai');
    expect(domainOf('not a url')).toBeNull();
  });
});

const call = (over: Partial<CallSummary> & { at: string }): CallSummary => ({
  id: over.id ?? `call_${over.at}`,
  status: 'ended',
  source: 'trellus',
  startedAt: new Date(over.at).getTime(),
  durationMs: 60_000,
  prospect: over.prospect ?? { name: 'Someone', title: '', company: '' },
  outcome: over.outcome ?? 'no_answer',
  suggestions: 0,
  used: 0,
  ...(over.contactId ? { contactId: over.contactId } : {}),
});

describe('the team history', () => {
  it("finds this person's calls by contact, or by name and company, newest first", () => {
    const calls = [
      call({ at: '2026-08-03T10:00:00', prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs' } }),
      call({ at: '2026-09-12T10:00:00', prospect: { name: 'maya chen', title: '', company: '' } }),
      call({ at: '2026-09-20T10:00:00', prospect: { name: 'Maya Chen', title: '', company: 'Other Co' } }),
      call({ at: '2026-09-21T10:00:00', contactId: 'ct_1', prospect: { name: 'M. Chen', title: '', company: '' } }),
    ];
    expect(pastCallsFor(calls, { name: 'Maya Chen', company: 'Lumen Labs' }).map((c) => c.startedAt)).toEqual([new Date('2026-09-12T10:00:00').getTime(), new Date('2026-08-03T10:00:00').getTime()]);
    expect(pastCallsFor(calls, { name: 'x', company: '' }, 'ct_1')).toHaveLength(1);
    expect(pastCallsFor(calls, { name: 'Maya Chen', company: '' }, null, calls[0]!.id)).toHaveLength(2);
  });

  it('says when the team connects, only with enough calls', () => {
    const calls: CallSummary[] = [];
    for (let i = 0; i < 6; i++) calls.push(call({ id: `a${i}`, at: `2026-09-0${i + 1}T09:20:00`, outcome: i < 4 ? 'follow_up' : 'no_answer' }));
    for (let i = 0; i < 6; i++) calls.push(call({ id: `b${i}`, at: `2026-09-0${i + 1}T14:20:00`, outcome: i < 1 ? 'meeting_booked' : 'voicemail' }));
    const h = bestHours(calls)!;
    expect(h.best.hour).toBe(9);
    expect(h.buckets).toHaveLength(10);
    expect(hourWords(9)).toBe('9 am to 10 am');
    expect(hourWords(12)).toBe('12 pm to 1 pm');
    expect(bestHours(calls.slice(0, 5))).toBeNull();
  });

  it('keys a prospect by name, company and phone digits', () => {
    expect(prospectKey({ name: ' Maya ', company: 'Lumen', phone: '+1 (415) 555-0142' })).toBe('maya|lumen|14155550142');
    expect(prospectKey(null)).toBe('');
  });
});

describe('the toolbar badge and the outcome notification', () => {
  it('shows the call timer live, a flag for a claim, a tick when booked and the hook count before a call', () => {
    const v = live();
    const now = v.startedAt + 134_000;
    expect(badgeFor({ ...initialState(), phase: 'live', view: v }, now)).toMatchObject({ text: '2:14' });
    const compliance = { ...v, current: { ...v.current!, kind: 'compliance' as const } };
    expect(badgeFor({ ...initialState(), phase: 'live', view: compliance }, now).text).toBe('!');
    const booked = viewAt((e) => e.type === 'outcome.recorded');
    expect(badgeFor({ ...initialState(), phase: 'ended', view: booked }, now).text).toBe(booked.outcome?.outcome === 'meeting_booked' ? '✓' : '');
    const page = { tabId: 1, host: 'app.hubspot.com', prospect: { name: 'Maya', title: '', company: '', facts: {} }, trellus: { present: true, state: 'dialing' as const } };
    expect(badgeFor({ ...initialState(), page }, now, 3).text).toBe('3');
    expect(badgeFor(initialState(), now, 3).text).toBe('');
  });

  it('notifies once per call, only for an outcome the rep did not tap', () => {
    const ended = viewAt((e) => e.type === 'call.ended');
    const fromTrellus = { ...ended, outcome: { outcome: 'meeting_booked' as const, source: 'trellus' as const, raw: {}, at: 1 } };
    const told = new Set<string>();
    const note = outcomeNote(ended, fromTrellus, told)!;
    expect(note.title).toContain('Meeting booked');
    expect(note.message).toContain('Trellus');
    expect(outcomeNote(ended, fromTrellus, told)).toBeNull();
    expect(outcomeNote(null, { ...fromTrellus, id: 'call_other', outcome: { ...fromTrellus.outcome, source: 'rep' } }, new Set())).toBeNull();
  });

  it('escapes omnibox text', () => {
    expect(xml(`<Lumen & "Labs">`)).toBe('&lt;Lumen &amp; &quot;Labs&quot;&gt;');
  });
});

describe('settings from the web app', () => {
  it('takes only what the web app may change, typed, and never the server or token', () => {
    const cur = defaultSettings();
    const p = webPatch({ direction: 'night', theme: 'nope', autoStart: false, overlay: 'yes', serverUrl: 'https://evil.example', token: 'x', hosts: { hubspot: false, bogus: true }, rep: { id: 'rep_alex', name: '  Alex Rivera ' } }, cur)!;
    expect(p).toEqual({ direction: 'night', autoStart: false, hosts: { ...cur.hosts, hubspot: false }, rep: { id: 'rep_alex', name: 'Alex Rivera' } });
    expect(webPatch({ rep: { id: 'bad id with spaces' } }, { ...cur, rep: { id: 'rep_1', name: 'A' } })).toEqual({ rep: { id: 'rep_1', name: 'A' } });
    expect(webPatch('nope', cur)).toBeNull();
    expect(webPatch({}, cur)).toBeNull();
    expect(JSON.stringify(publicSettings({ ...cur, token: 'tok_secret' }))).not.toContain('tok_secret');
  });
});

function fakeChrome(opts: { split?: boolean; splitFails?: boolean } = {}) {
  const tabs = new Map<number, { id: number; windowId: number; index: number; url: string; splitViewId?: number }>([[9, { id: 9, windowId: 2, index: 3, url: 'https://app.hubspot.com/x' }]]);
  let next = 100;
  const deps: BesideDeps = {
    getTab: vi.fn(async (id: number) => {
      const t = tabs.get(id);
      if (!t) throw new Error('No tab');
      return t;
    }),
    activeTab: vi.fn(async () => tabs.get(9)!),
    createTab: vi.fn(async (p: { url: string; windowId?: number; index?: number; splitWithTabId?: number }) => {
      if (p.splitWithTabId !== undefined && opts.splitFails) throw new Error('Cannot split');
      const t = { id: next++, windowId: p.windowId ?? 2, index: p.index ?? 0, url: p.url, ...(p.splitWithTabId !== undefined ? { splitViewId: 7 } : {}) };
      tabs.set(t.id, t);
      return t;
    }),
    updateTab: vi.fn(async (id: number, p: { url: string }) => {
      const t = tabs.get(id);
      if (!t) throw new Error('No tab');
      t.url = p.url;
      return t;
    }),
    removeTab: vi.fn(async (id: number) => void tabs.delete(id)),
    unsplit: vi.fn(async () => {}),
    getWindow: vi.fn(async (id: number) => ({ id, left: 0, top: 0, width: 1600, height: 1000, state: 'maximized' as const })),
    createWindow: vi.fn(async (p: { url: string }) => {
      const t = { id: next++, windowId: 3, index: 0, url: p.url };
      tabs.set(t.id, t);
      return { tabs: [t] };
    }),
    updateWindow: vi.fn(async () => ({})),
    focusWindow: vi.fn(async () => {}),
  };
  return { deps, tabs, beside: new Beside(deps, () => !!opts.split) };
}

describe('open beside the call', () => {
  it('splits with the call tab on Chrome 155+, then reuses that tab for the next source', async () => {
    const { deps, beside, tabs } = fakeChrome({ split: true });
    expect(await beside.show('https://lumenlabs.ai/blog', 9)).toBe('split');
    expect(deps.createTab).toHaveBeenCalledWith(expect.objectContaining({ splitWithTabId: 9, index: 4, windowId: 2 }));
    expect(await beside.show('https://jobs.example.com/lumen', 9)).toBe('split');
    expect(deps.createTab).toHaveBeenCalledTimes(1);
    expect(tabs.get(beside.current!.tabId)!.url).toBe('https://jobs.example.com/lumen');
    await beside.close();
    expect(deps.unsplit).toHaveBeenCalledWith(7);
    expect(tabs.has(100)).toBe(false);
    expect(beside.current).toBeNull();
  });

  it('puts a window on the right half when Chrome cannot split', async () => {
    const { deps, beside } = fakeChrome({ split: false });
    expect(await beside.show('https://lumenlabs.ai/blog', 9)).toBe('window');
    expect(deps.updateWindow).toHaveBeenCalledWith(2, { state: 'normal', left: 0, top: 0, width: 800, height: 1000 });
    expect(deps.createWindow).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://lumenlabs.ai/blog', left: 800, width: 800, focused: true }));
  });

  it('falls back from a refused split, and opens a fresh tab when the rep closed the old one', async () => {
    const { beside, tabs } = fakeChrome({ split: true, splitFails: true });
    expect(await beside.show('https://lumenlabs.ai/blog', 9)).toBe('window');
    tabs.delete(beside.current!.tabId);
    expect(await beside.show('https://lumenlabs.ai/jobs', 9)).toBe('window');
  });

  it('puts the call window back when Chrome refuses the second window, and opens the next tab', async () => {
    const { deps, beside } = fakeChrome({ split: false });
    (deps.createWindow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Bounds must be at least 50% within visible screen space'));
    expect(await beside.show('https://lumenlabs.ai/blog', 9)).toBe('tab');
    expect(deps.updateWindow).toHaveBeenLastCalledWith(2, { state: 'maximized' });
    expect(deps.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://lumenlabs.ai/blog', index: 4 }));
  });

  it('only opens web pages', async () => {
    const { beside } = fakeChrome({ split: true });
    expect(besideUrl('javascript:alert(1)')).toBeNull();
    expect(besideUrl('chrome://settings')).toBeNull();
    await expect(beside.show('file:///etc/passwd', 9)).rejects.toThrow(/web pages/);
  });
});
