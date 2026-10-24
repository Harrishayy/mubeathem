import { FeedbackRequest, MOMENTS, type CallView } from '@cue/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  BriefView,
  CallTimer,
  ComplianceCard,
  ConnectionPill,
  CueRoot,
  DebriefForm,
  FlagsView,
  ModelGrowthPanel,
  MomentChip,
  momentParts,
  OutcomeBar,
  Overbar,
  PersonaChip,
  PlaybookBoard,
  ProspectHeader,
  ReceptivityMeter,
  SuggestionCard,
  TranscriptView,
  UpNextList,
  type OverbarPlacement,
  type SuggestionCardHandle,
} from '../src';
import { CARD_SPECS, suggestionFrom } from '../src/fixtures/demo';
import { COMPLIANCE_SUGGESTION, DEMO_PLAYBOOK, DEMO_STATS, VIEWS, stressSuggestion } from '../src/fixtures/views';

const wrap = (ui: ReactNode) => render(<CueRoot theme="light">{ui}</CueRoot>);
const noop = () => {};

describe('Overbar', () => {
  const states: [string, CallView | null, 'live' | 'reconnecting' | 'offline'][] = [
    ['no call', null, 'live'],
    ...Object.entries(VIEWS).map(([k, f]) => [k, f(), 'live'] as [string, CallView, 'live']),
    ['reconnecting', VIEWS.cold(), 'reconnecting'],
    ['offline', VIEWS.cold(), 'offline'],
  ];
  const placements: OverbarPlacement[] = ['top', 'inline', 'sheet'];

  it.each(states)('renders %s collapsed and expanded in every placement', (_, view, conn) => {
    for (const placement of placements) {
      for (const mode of ['collapsed', 'expanded'] as const) {
        const { unmount } = wrap(<Overbar view={view} connection={conn} mode={mode} onModeChange={noop} onAction={noop} placement={placement} />);
        unmount();
      }
    }
  });

  it('the collapsed bar shows the line once, as a live region, and expands', () => {
    const onMode = vi.fn();
    const v = VIEWS.cold();
    wrap(<Overbar view={v} connection="live" mode="collapsed" onModeChange={onMode} onAction={noop} placement="inline" />);
    const line = screen.getByText(v.current!.say);
    expect(line.getAttribute('aria-live')).toBe('polite');
    const expand = screen.getByRole('button', { name: 'Expand' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(onMode).toHaveBeenCalledWith('expanded');
  });

  it('expanded: header controls, then the card, then up next and drawers, in tab order', () => {
    const v = VIEWS.cold();
    const onEnd = vi.fn();
    wrap(<Overbar view={v} connection="live" mode="expanded" onModeChange={noop} onAction={noop} onEnd={onEnd} onOpenSettings={noop} placement="inline" />);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(names.slice(0, 4)).toEqual(['Settings', 'End call', 'Collapse', 'Used it']);
    expect(names.indexOf('Brief')).toBeGreaterThan(names.indexOf('Dismiss'));
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(onEnd).toHaveBeenCalled();
  });

  it('Escape collapses when focus is inside', () => {
    const onMode = vi.fn();
    wrap(<Overbar view={VIEWS.cold()} connection="live" mode="expanded" onModeChange={onMode} onAction={noop} placement="inline" />);
    screen.getByRole('button', { name: 'Used it' }).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onMode).toHaveBeenCalledWith('collapsed');
  });

  it('card actions reach onAction with the suggestion id', () => {
    const onAction = vi.fn();
    const v = VIEWS.objection();
    wrap(<Overbar view={v} connection="live" mode="expanded" onModeChange={noop} onAction={onAction} placement="inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Used it' }));
    expect(onAction).toHaveBeenCalledWith(v.current!.id, 'used', undefined);
  });

  it('a compliance view shows the compliance card as an alert', () => {
    wrap(<Overbar view={VIEWS.compliance()} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />);
    expect(screen.getByRole('alert').textContent).toContain('Try instead');
  });

  it('renders the accessory with the bar in every placement', () => {
    for (const placement of ['top', 'inline', 'sheet'] as const) {
      const { unmount } = wrap(<Overbar view={VIEWS.cold()} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement={placement} accessory={<button type="button">Start Cue</button>} />);
      const acc = screen.getByRole('button', { name: 'Start Cue' });
      expect(acc.closest('.cue-overbar')).toBeTruthy();
      unmount();
    }
  });

  it('keeps one line in the DOM after a card swap', () => {
    const a = VIEWS.gatekeeper();
    const b = VIEWS.opener();
    const { rerender } = wrap(<Overbar view={a} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" />);
    rerender(
      <CueRoot theme="light">
        <Overbar view={b} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" />
      </CueRoot>,
    );
    expect(document.querySelectorAll('.cue-bar__text')).toHaveLength(1);
    expect(screen.queryByText(a.current!.say)).toBeNull();
  });

  it('collapsed chip uses a whole-word label, with an icon-only fallback', () => {
    wrap(<Overbar view={VIEWS.cold()} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" />);
    expect(screen.getAllByText('Regarding?').length).toBeGreaterThan(0);
  });

  it('passes a replay clock to the timer', () => {
    const v = VIEWS.cold();
    wrap(<Overbar view={v} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" now={v.startedAt + 61_000} />);
    expect(screen.getByText('01:01')).toBeTruthy();
  });

  it('offline says so in words', () => {
    wrap(<Overbar view={VIEWS.cold()} connection="offline" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" />);
    expect(screen.getByRole('status').textContent).toContain('Offline');
  });
});

describe('SuggestionCard', () => {
  it.each(Object.entries(CARD_SPECS))('%s renders its line, moment and evidence', (_, spec) => {
    const s = suggestionFrom(spec);
    wrap(<SuggestionCard suggestion={s} onAction={noop} />);
    expect(screen.getByRole('article').textContent).toContain(s.say);
    expect(screen.getByText(s.evidence.text)).toBeTruthy();
  });

  it('edit flow saves the rep’s text as an edited action', () => {
    const onAction = vi.fn();
    const s = suggestionFrom(CARD_SPECS.broker);
    wrap(<SuggestionCard suggestion={s} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit the line' }));
    const box = screen.getByLabelText('Say it your way');
    fireEvent.change(box, { target: { value: 'When did they last re-quote you?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onAction).toHaveBeenCalledWith(s.id, 'edited', 'When did they last re-quote you?');
  });

  it('marks a fallback honestly, never as the model', () => {
    wrap(<SuggestionCard suggestion={{ ...suggestionFrom(CARD_SPECS.opener), servedBy: 'rules' }} />);
    expect(screen.getByText('Playbook line as written · model offline')).toBeTruthy();
  });

  it('debug shows the path, latency and request id', () => {
    const s = suggestionFrom(CARD_SPECS.opener);
    wrap(<SuggestionCard suggestion={s} debug />);
    expect(screen.getByRole('article').textContent).toContain(`mubit · ${s.latencyMs} ms`);
  });

  it('does not repeat the moment in the situation label', () => {
    wrap(<SuggestionCard suggestion={suggestionFrom(CARD_SPECS.gatekeeper)} />);
    expect(screen.getAllByText('Gatekeeper')).toHaveLength(1);
  });

  it('exposes a handle for keyboard shortcuts, and controlled editing', () => {
    const onAction = vi.fn();
    const onEditingChange = vi.fn();
    const ref = createRef<SuggestionCardHandle>();
    const s = suggestionFrom(CARD_SPECS.broker);
    const { rerender } = wrap(<SuggestionCard ref={ref} suggestion={s} onAction={onAction} editing={false} onEditingChange={onEditingChange} />);
    act(() => ref.current!.use());
    expect(onAction).toHaveBeenLastCalledWith(s.id, 'used', undefined);
    act(() => ref.current!.dismiss());
    expect(onAction).toHaveBeenLastCalledWith(s.id, 'dismissed', undefined);
    act(() => ref.current!.edit());
    expect(onEditingChange).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText('Say it your way')).toBeNull();
    rerender(
      <CueRoot theme="light">
        <SuggestionCard ref={ref} suggestion={s} onAction={onAction} editing onEditingChange={onEditingChange} />
      </CueRoot>,
    );
    expect(screen.getByLabelText('Say it your way')).toBeTruthy();
  });

  it('thumbs are toggle buttons with pressed state', () => {
    wrap(<SuggestionCard suggestion={suggestionFrom(CARD_SPECS.opener)} onAction={noop} />);
    const up = screen.getByRole('button', { name: 'Good suggestion' });
    fireEvent.click(up);
    expect(up.getAttribute('aria-pressed')).toBe('true');
  });

  it('stress strings render in hero and compact without throwing', () => {
    wrap(
      <>
        <SuggestionCard suggestion={stressSuggestion()} onAction={noop} />
        <SuggestionCard suggestion={stressSuggestion()} size="compact" />
      </>,
    );
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});

describe('ComplianceCard', () => {
  it('shows the claim, the rule and the rephrase', () => {
    const onAction = vi.fn();
    const s = COMPLIANCE_SUGGESTION();
    wrap(<ComplianceCard suggestion={s} onAction={onAction} />);
    const card = screen.getByRole('alert');
    expect(card.textContent).toContain(s.compliance!.claim);
    expect(card.textContent).toContain(s.compliance!.rule);
    fireEvent.click(within(card).getByRole('button', { name: 'Got it' }));
    expect(onAction).toHaveBeenCalledWith(s.id, 'used');
  });
});

describe('call parts', () => {
  it('MomentChip renders every moment with a visible label', () => {
    wrap(
      <>
        {MOMENTS.map((m) => (
          <MomentChip key={m} moment={m} />
        ))}
      </>,
    );
    expect(screen.getByText('Buying signal')).toBeTruthy();
    // Phrase moments set the kind in capitals and the prospect's words in a <q>.
    expect(screen.getByText('What’s this regarding?').tagName).toBe('Q');
    const broker = screen.getByTitle('Objection: “we have a broker”');
    expect(broker.querySelector('.cue-moment__kind')?.textContent).toBe('Objection');
    expect(broker.querySelector('q')?.textContent).toBe('we have a broker');
    expect(screen.getByTitle('Objection: price').textContent).toBe('Objectionprice');
  });

  it('momentParts splits kind, phrase and detail', () => {
    expect(momentParts('brush_off_email')).toEqual({ kind: 'Brush-off', said: 'send me an email', detail: null });
    expect(momentParts('whats_this_regarding')).toEqual({ kind: null, said: 'What’s this regarding?', detail: null });
    expect(momentParts('objection_timing')).toEqual({ kind: 'Objection', said: null, detail: 'timing' });
    expect(momentParts('close')).toEqual({ kind: 'Close', said: null, detail: null });
  });

  it('PersonaChip says when it is unsure', () => {
    wrap(<PersonaChip persona="cfo" confidence={0.4} />);
    expect(screen.getByLabelText('Talking to: CFO, 40% sure')).toBeTruthy();
  });

  it('ReceptivityMeter is a meter with a word value', () => {
    wrap(<ReceptivityMeter score={-0.9} trend={[{ tMs: 0, score: 0.2 }, { tMs: 1, score: -0.2 }, { tMs: 2, score: -0.9 }]} />);
    const m = screen.getByRole('meter', { name: 'Receptivity' });
    expect(m.getAttribute('aria-valuetext')).toBe('Cold, cooling');
  });

  it('CallTimer follows a supplied clock instead of the wall', () => {
    wrap(<CallTimer startedAt={1_000} now={1_000 + 75_000} />);
    expect(screen.getByText('01:15')).toBeTruthy();
  });

  it('CallTimer ticks and stops at the end', () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    wrap(<CallTimer startedAt={t0 - 134_000} />);
    expect(screen.getByText('02:14')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('02:16')).toBeTruthy();
    vi.useRealTimers();
  });

  it('ConnectionPill states', () => {
    wrap(
      <>
        <ConnectionPill connection="live" />
        <ConnectionPill connection="reconnecting" />
      </>,
    );
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['Live', 'Reconnecting…']);
  });

  it('ProspectHeader, UpNext, Transcript, Brief, Flags render with fixtures and stress', () => {
    for (const v of [VIEWS.cold(), VIEWS.stress()]) {
      const { unmount } = wrap(
        <>
          <ProspectHeader prospect={v.prospect} situation={v.situation} trend={v.receptivityTrend} />
          <UpNextList items={v.current?.upNext ?? []} />
          <TranscriptView turns={v.turns} />
          <BriefView brief={v.brief} />
          <BriefView brief={null} loading />
          <FlagsView flags={v.flags} />
          <FlagsView flags={[]} />
        </>,
      );
      expect(screen.getByRole('heading', { name: v.prospect.name })).toBeTruthy();
      unmount();
    }
  });
});

describe('DebriefForm', () => {
  it('requires an outcome before submitting', async () => {
    const onSubmit = vi.fn(async () => {});
    wrap(<DebriefForm view={{ ...VIEWS.ended(), outcome: null }} onSubmit={onSubmit} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save debrief' })));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an outcome to save the call.')).toBeTruthy();
  });

  it('is keyboard first: number keys pick, Cmd+Enter submits a valid FeedbackRequest', async () => {
    const onSubmit = vi.fn(async (_: FeedbackRequest) => {});
    wrap(<DebriefForm view={{ ...VIEWS.ended(), outcome: null }} onSubmit={onSubmit} />);
    const group = screen.getByRole('radiogroup', { name: 'Outcome' });
    expect(document.activeElement && group.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(group, { key: '2' });
    expect(within(group).getByRole('radio', { name: 'Follow-up agreed' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.keyDown(group, { key: 'Enter', metaKey: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const f = onSubmit.mock.calls[0]![0];
    expect(FeedbackRequest.parse(f).outcome).toBe('follow_up');
    expect(screen.getByText('Thanks. Cue is learning from this call.')).toBeTruthy();
  });

  it('shows a retryable error when the save fails', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Server unreachable');
    });
    wrap(<DebriefForm view={VIEWS.booked()} onSubmit={onSubmit} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save debrief' })));
    expect(screen.getByRole('alert').textContent).toContain('Server unreachable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('pre-fills thumbs from the call', () => {
    wrap(<DebriefForm view={VIEWS.booked()} onSubmit={async () => {}} autoFocus={false} />);
    expect(screen.getAllByRole('button', { name: 'Helped' }).some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);
  });
});

describe('after the call', () => {
  it('OutcomeBar reports the tapped outcome', () => {
    const on = vi.fn();
    wrap(<OutcomeBar onOutcome={on} />);
    fireEvent.click(screen.getByRole('button', { name: /Booked/ }));
    expect(on).toHaveBeenCalledWith('meeting_booked');
  });

  it('OutcomeBar has no primary until a value is chosen', () => {
    const { rerender } = wrap(<OutcomeBar onOutcome={noop} value={null} />);
    expect(document.querySelectorAll('.cue-btn--primary')).toHaveLength(0);
    rerender(
      <CueRoot theme="light">
        <OutcomeBar onOutcome={noop} value="follow_up" />
      </CueRoot>,
    );
    const primary = document.querySelectorAll('.cue-btn--primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Follow-up');
  });

  it('PlaybookBoard marks just-learned lines', () => {
    wrap(<PlaybookBoard data={DEMO_PLAYBOOK} highlightIds={['line_cand_1', 'line_wtr_cold']} />);
    expect(screen.getAllByText('Just learned')).toHaveLength(2);
  });

  it('PlaybookBoard approves a clean candidate and blocks a policy breach', () => {
    const approve = vi.fn();
    wrap(<PlaybookBoard data={DEMO_PLAYBOOK} onApprove={approve} onReject={noop} />);
    const buttons = screen.getAllByRole('button', { name: 'Approve' }) as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
    fireEvent.click(buttons[0]!);
    expect(approve).toHaveBeenCalledWith('line_cand_1');
    expect(screen.getByText(/Approved/)).toBeTruthy();
  });

  it('ModelGrowthPanel shows each task against the adapter threshold', () => {
    wrap(<ModelGrowthPanel stats={DEMO_STATS} live />);
    expect(screen.getAllByRole('meter')).toHaveLength(DEMO_STATS.tasks.length);
    expect(screen.getByText('3 of 6 tasks', { exact: false })).toBeTruthy();
  });
});
