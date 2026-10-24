import { OUTCOME_LABEL, PERSONA_LABEL, formatDuration, type CallView, type Speaker, type SuggestionAction } from '@cue/core';
import {
  ActionBar,
  Bar,
  BriefView,
  Button,
  Chip,
  CueStage,
  FlagsView,
  Icon,
  IconButton,
  KeyValue,
  MomentChip,
  OutcomeBar,
  Pane,
  PaneSection,
  ReceptivityMeter,
  SegmentedControl,
  Skeleton,
  TranscriptView,
  UpNextList,
  VisuallyHidden,
  cueLabel,
  type ChipTone,
  type SuggestionCardHandle,
} from '@cue/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { request, type CaptureStatus, type SessionState } from '../../src/messages';
import { webAppRoute, type Settings } from '../../src/settings';
import type { SessionHook } from '../../src/ui/useSession';
import { useCardShortcuts } from '../../src/ui/useCardShortcuts';
import { DebriefDialog } from './Debrief';
import { LastTime } from './LastTime';
import { MicPermission } from './MicPermission';
import { StartCall } from './StartCall';

const docScope = () => document;

const CAPTURE_TONE: Record<CaptureStatus['state'], ChipTone> = { off: 'neutral', starting: 'info', on: 'ok', unavailable: 'warn', denied: 'bad', error: 'bad' };
const CAPTURE_WORD: Record<CaptureStatus['state'], string> = { off: 'off', starting: 'starting', on: 'on', unavailable: 'not transcribed', denied: 'blocked', error: 'not working' };

/** How sure Cue is about who it's talking to, in words. */
function sureness(c: number): string {
  return c >= 0.8 ? 'fairly sure' : c >= 0.55 ? 'probably' : 'a guess so far';
}

/**
 * Only this call, as stacked dashboard panes: the line to say now (with what's next under it), audio,
 * the brief (what Cue found and an opener), last time with this contact, the person on the line, and
 * the transcript with the typed-turn composer. Listening and ending the call sit in a pinned bar.
 */
export function Live({ session, settings, onOpenSettings }: { session: SessionHook; settings: Settings; onOpenSettings: () => void }) {
  const { state } = session;
  const cardRef = useRef<SuggestionCardHandle>(null);
  useCardShortcuts(cardRef, docScope, state.phase === 'live');
  const onAction = useCallback((suggestionId: string, action: SuggestionAction, text?: string) => {
    void request({ type: 'session.action', suggestionId, action, ...(text ? { text } : {}) });
  }, []);

  // The debrief opens by itself once per ended call; closing it leaves the call on screen.
  const [debriefFor, setDebriefFor] = useState<string | null>(null);
  const offered = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase === 'ended' && state.callId && state.view && !state.view.feedback && offered.current !== state.callId) {
      offered.current = state.callId;
      setDebriefFor(state.callId);
    }
    if (state.phase === 'idle') setDebriefFor(null);
  }, [state.phase, state.callId, state.view]);

  if (state.phase === 'idle') {
    return <StartCall state={state} settings={settings} onOpenSettings={onOpenSettings} />;
  }

  const view = state.view;
  const live = state.phase === 'live' || state.phase === 'starting';

  return (
    <>
      <main className="sp-main">
        {state.error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{state.error}</span>
          </p>
        )}
        {view ? <CuePane view={view} onAction={onAction} cardRef={cardRef} /> : <StartingPane />}
        {live && <AudioPane state={state} />}
        {view && <BriefPane view={view} live={live} />}
        {view?.contactId && (
          <Pane label="Last time" scroll={false} pad="none">
            <p className="sp-explain">How your previous call with {firstName(view)} went, so you can pick up where you left off.</p>
            <LastTime contactId={view.contactId} excludeCallId={view.id} first={firstName(view)} />
          </Pane>
        )}
        {view && <ProspectPane view={view} />}
        {view && <TranscriptPane view={view} pending={state.pendingTurns} canType={live} />}
        <p className="sp-foot">
          Past calls and team numbers are in the Cue app.{' '}
          <a className="sp-link" href={view?.contactId ? webAppRoute(settings, 'history', { contact: view.contactId }) : webAppRoute(settings, 'history')} target="_blank" rel="noreferrer">
            Open in Cue
            <Icon name="external" size={12} />
            <span className="cue-vh"> (opens in a new tab)</span>
          </a>
        </p>
      </main>
      <footer className="sp-dock" aria-label="Call actions">
        {live ? <LiveActions state={state} /> : <EndedActions view={view} onDebrief={() => state.callId && setDebriefFor(state.callId)} />}
      </footer>
      {view && state.phase === 'ended' && <DebriefDialog state={state} open={debriefFor === state.callId} onClose={() => setDebriefFor(null)} />}
    </>
  );
}

const firstName = (view: CallView) => view.prospect.name.split(' ')[0] || view.prospect.name || 'them';

/** What Cue found before the call (summary, hooks with where they came from, an opener), and claims to check. */
function BriefPane({ view, live }: { view: CallView; live: boolean }) {
  return (
    <Pane label="Brief" meta={view.brief ? `${view.brief.hooks.length} talking ${view.brief.hooks.length === 1 ? 'point' : 'points'}` : live ? 'researching' : undefined} pad="none" scroll={false}>
      <p className="sp-explain">What Cue found about {firstName(view)} and their company, with a way to open the call.</p>
      <div className="sp-brief">
        <BriefView brief={view.brief} loading={!view.brief && live} />
      </div>
      {view.flags.length > 0 && (
        <PaneSection label="Claims to check" meta={String(view.flags.length)}>
          <p className="sp-hint sp-pad-x">Things said on the call that may break your company's rules. Check before you repeat them.</p>
          <FlagsView flags={view.flags} />
        </PaneSection>
      )}
    </Pane>
  );
}

function StartingPane() {
  return (
    <Pane label="Cue" meta="starting the call" scroll={false}>
      <div className="sp-loading" aria-busy="true">
        <Skeleton lines={2} height={18} />
        <Skeleton width="45%" height={12} />
      </div>
    </Pane>
  );
}

function CuePane({ view, onAction, cardRef }: { view: CallView; onAction: (id: string, a: SuggestionAction, text?: string) => void; cardRef: React.RefObject<SuggestionCardHandle | null> }) {
  const live = view.status === 'live';
  const current = live ? view.current : null;
  const at = current ? view.history.findIndex((h) => h.suggestion.id === current.id) : -1;
  const cueNo = current ? (at >= 0 ? at + 1 : view.history.length + 1) : null;
  return (
    <Pane
      label="Cue"
      meta={current && cueNo ? cueLabel(cueNo) : live ? (view.pending ? 'reading' : 'listening') : view.outcome ? OUTCOME_LABEL[view.outcome.outcome] : 'ended'}
      actions={
        <>
          {current && <MomentChip moment={current.kind === 'compliance' ? 'compliance' : current.situation.moment} size="sm" />}
          {current && (
            <span className="cue-label" title={current.servedBy === 'mubit' ? 'Written for this moment by your trained model' : 'A proven line from the playbook (the model was not used)'}>
              {current.servedBy === 'mubit' ? `tailored in ${(current.latencyMs / 1000).toFixed(1)} s` : 'playbook line'}
            </span>
          )}
        </>
      }
      pad="none"
      scroll={false}
      className="sp-cue"
    >
      {live && <p className="sp-explain">{current ? 'Say this next. Keys: U used it, D skip, E edit.' : 'Cue listens and puts the line to say here when the prospect speaks.'}</p>}
      <CueStage view={view} onAction={onAction} cardRef={cardRef} shortcuts variant="flush" />
      {current && current.upNext.length > 0 && (
        <div className="sp-standby">
          <span className="cue-label">If that doesn't fit</span>
          <UpNextList items={current.upNext} />
        </div>
      )}
      {view.lastError && live && (
        <p className="sp-note" role="status">
          <Icon name="info" size={14} />
          {view.lastError.message}
        </p>
      )}
    </Pane>
  );
}

/** Capture of both sides, with the reason and the fix when one side isn't heard. */
function AudioPane({ state }: { state: SessionState }) {
  const { tab, mic } = state.capture;
  const problems = [tab, mic].filter((c) => c.message && (c.state === 'denied' || c.state === 'error' || c.state === 'unavailable'));
  const tabTranscribed = tab.state === 'on';
  return (
    <Pane label="Audio" meta={tabTranscribed && mic.state === 'on' ? 'hearing both sides' : undefined} scroll={false} pad="sm">
      <div className="sp-audio">
        <p className="sp-hint">What Cue can hear. The prospect comes from this tab, you from your microphone.</p>
        <div className="sp-chips">
          <Chip size="sm" tone={CAPTURE_TONE[tab.state]} icon="phone">
            Prospect audio {CAPTURE_WORD[tab.state]}
          </Chip>
          <Chip size="sm" tone={CAPTURE_TONE[mic.state]} icon={mic.state === 'on' ? 'mic' : 'mic-off'}>
            Your mic {CAPTURE_WORD[mic.state]}
          </Chip>
        </div>
        {problems.map((p, i) => (
          <p key={i} className="sp-note sp-note--warn">
            <Icon name="alert" size={14} />
            {p.message}
          </p>
        ))}
        {mic.state === 'denied' && <MicPermission compact />}
        {!tabTranscribed && mic.state === 'on' && (
          <SegmentedControl<Speaker>
            label="Your mic is hearing"
            showLabel
            size="sm"
            value={state.micSpeaker}
            onChange={(speaker) => void request({ type: 'capture.micSpeaker', speaker })}
            options={[
              { value: 'rep', label: 'Me' },
              { value: 'prospect', label: 'The prospect' },
            ]}
          />
        )}
        {(tab.state === 'off' && mic.state === 'off') && <p className="sp-hint">Not listening. You can still type what was said in the transcript below.</p>}
      </div>
    </Pane>
  );
}

function ProspectPane({ view }: { view: CallView }) {
  const live = view.status === 'live';
  const situation = view.situation;
  const final = view.turns.filter((t) => t.final);
  const words = (s: Speaker) => final.filter((t) => t.speaker === s).reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
  const repWords = words('rep');
  const allWords = repWords + words('prospect');
  const stage = view.prospect.facts.stage ?? view.prospect.facts.funding;
  return (
    <Pane label="Prospect" meta={view.source === 'trellus' ? 'Trellus' : undefined} pad="none" scroll={false} as="aside">
      <div className="sp-prospect">
        <h2 className="sp-prospect__name">{view.prospect.name || view.prospect.company || 'Unnamed prospect'}</h2>
        <p className="sp-prospect__role">{[view.prospect.title, view.prospect.company].filter(Boolean).join(' · ') || 'No title or company known'}</p>
        <KeyValue
          items={[
            ...(view.prospect.phone ? [{ label: 'Phone', value: <span className="cue-num">{view.prospect.phone}</span> }] : []),
            ...(stage ? [{ label: 'Stage', value: stage }] : []),
            ...(situation
              ? [
                  {
                    label: 'Talking to',
                    value: (
                      <>
                        {situation.persona === 'unknown' ? 'Not sure yet' : PERSONA_LABEL[situation.persona]} <span className="sp-muted">({sureness(situation.personaConfidence)})</span>
                      </>
                    ),
                  },
                  {
                    label: 'How open they are',
                    value: <ReceptivityMeter score={situation.receptivityScore} trend={view.receptivityTrend} />,
                  },
                ]
              : []),
            ...(allWords > 0 ? [{ label: 'You talked', value: <Bar value={repWords / allWords} label={`${Math.round((repWords / allWords) * 100)}% of the words`} tone="accent" /> }] : []),
            { label: 'Lines used', value: <span className="cue-num">{`${view.history.filter((h) => h.action === 'used' || h.action === 'edited').length} of ${view.history.length} suggested`}</span> },
            ...(view.endedAt ? [{ label: 'Length', value: <span className="cue-num">{formatDuration(view.endedAt - view.startedAt)}</span> }] : []),
          ]}
        />
      </div>
      {live && (
        <PaneSection label="How did it end?">
          <p className="sp-hint sp-pad-b">Tap the outcome to end the call. It teaches Cue what works.</p>
          <OutcomeBar onOutcome={(outcome) => void request({ type: 'session.end', outcome })} value={view.outcome?.outcome ?? null} />
        </PaneSection>
      )}
    </Pane>
  );
}

function TranscriptPane({ view, pending, canType }: { view: CallView; pending: number; canType: boolean }) {
  const final = view.turns.filter((t) => t.final);
  const interim = view.turns.at(-1)?.final === false ? view.turns.at(-1)! : null;
  const first = view.prospect.name.split(' ')[0] || 'Prospect';
  return (
    <Pane
      label="Transcript"
      meta={`${final.length} ${final.length === 1 ? 'turn' : 'turns'}`}
      actions={
        pending > 0 ? (
          <Chip size="sm" tone="warn" icon="wifi-off">
            {pending} waiting
          </Chip>
        ) : undefined
      }
      pad="none"
      scroll={false}
      footer={canType ? <Composer first={first} /> : undefined}
    >
      {final.length === 0 && !interim ? (
        <p className="sp-empty">Nothing said yet. What Cue hears shows up here. If it can't hear the call, type what was said below.</p>
      ) : (
        <TranscriptView turns={final} interim={interim} highlightTurnId={view.current?.turnId} names={{ prospect: first }} maxHeight={320} follow className="sp-transcript" />
      )}
    </Pane>
  );
}

/** Typed turns: the fallback when capture is off or the prospect's audio isn't transcribed. */
function Composer({ first }: { first: string }) {
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState<Speaker>('prospect');
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const res = await request({ type: 'session.turn', speaker, text: t });
    if (res.ok) {
      setText('');
      setError(undefined);
      input.current?.focus();
    } else setError(res.error);
  };
  return (
    <form className="sp-composer" onSubmit={send} aria-label="Add a line to the transcript">
      <SegmentedControl<Speaker>
        label="Who said it"
        size="sm"
        value={speaker}
        onChange={setSpeaker}
        options={[
          { value: 'prospect', label: first },
          { value: 'rep', label: 'Me' },
        ]}
      />
      <span className="sp-composer__row">
        <label htmlFor="sp-say">
          <VisuallyHidden>Type what was said</VisuallyHidden>
        </label>
        <input
          id="sp-say"
          ref={input}
          className="sp-input"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          placeholder={speaker === 'prospect' ? `What did ${first} say?` : 'What did you say?'}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'sp-say-error' : undefined}
        />
        <IconButton icon="arrow-right" label="Add turn" type="submit" variant="primary" disabled={!text.trim()} />
      </span>
      {error && (
        <p id="sp-say-error" className="sp-note sp-note--warn" role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </form>
  );
}

function LiveActions({ state }: { state: SessionState }) {
  const { tab, mic } = state.capture;
  const listening = [tab.state, mic.state].some((s) => s === 'on' || s === 'starting');
  const [busy, setBusy] = useState<'listen' | 'end' | null>(null);
  const run = async (kind: 'listen' | 'end') => {
    setBusy(kind);
    if (kind === 'end') await request({ type: 'session.end' });
    else await request({ type: listening ? 'capture.stop' : 'capture.retry' });
    setBusy(null);
  };
  return (
    <ActionBar
      end={
        <Button variant="danger" icon="phone-off" loading={busy === 'end'} onClick={() => void run('end')}>
          End call
        </Button>
      }
    >
      <Button variant="secondary" icon={listening ? 'mic-off' : 'mic'} loading={busy === 'listen'} onClick={() => void run('listen')} disabled={state.phase !== 'live'}>
        {listening ? 'Stop listening' : 'Listen'}
      </Button>
    </ActionBar>
  );
}

function EndedActions({ view, onDebrief }: { view: CallView | null; onDebrief: () => void }) {
  return (
    <ActionBar
      end={
        <Button variant="ghost" icon="plus" onClick={() => void request({ type: 'session.reset' })}>
          Next call
        </Button>
      }
    >
      <Button variant="primary" icon="arrow-right" onClick={onDebrief} disabled={!view}>
        {view?.feedback ? 'See the review' : 'Debrief'}
      </Button>
    </ActionBar>
  );
}
