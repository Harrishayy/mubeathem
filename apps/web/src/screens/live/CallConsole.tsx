import { OUTCOME_LABEL, PERSONA_LABEL, formatDuration, type Speaker } from '@cue/core';
import {
  ActionBar,
  Bar,
  BriefView,
  Button,
  CallTimeline,
  Chip,
  ConnectionPill,
  CueStage,
  FlagsView,
  Icon,
  IconButton,
  KeyValue,
  OutcomeBar,
  Pane,
  PaneSection,
  ReceptivityMeter,
  SegmentedControl,
  TranscriptView,
  UpNextList,
  cueLabel,
} from '@cue/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useCapture } from '../../capture/useCapture';
import { currentSpeaker, dispatchSpeaker, speakerStore } from '../../capture/speaker';
import { levelStore } from '../../capture/level';
import { openPip, pipSupported } from '../../pip';
import { addTurn, callStore, detachCall } from '../../state/call';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { openDebrief, toast, uiStore } from '../../state/ui';
import { endAndDebrief, useOverbar } from '../../shell/useOverbar';
import { MomentChip } from '@cue/ui';

type SpeakMode = 'push' | 'prospect' | 'rep';

/**
 * The Live dashboard: transcript and capture on the left, the cue in the middle (with standby under
 * it), the prospect file on the right, and the call timeline across the bottom. On a laptop every
 * pane scrolls inside itself and the page never does; on a phone the panes stack.
 */
export function CallConsole() {
  const { view, connection, queued } = useStore(callStore);
  const bar = useOverbar({ hotkeys: false });
  const speaker = useStore(speakerStore);
  const level = useStore(levelStore);
  const pip = useStore(uiStore, (u) => u.pip);
  const transcriber = useStore(settingsStore, (s) => s.transcriber);
  const capture = useCapture(view?.startedAt ?? null);
  const [text, setText] = useState('');
  const [typedAs, setTypedAs] = useState<Speaker>('prospect');
  const input = useRef<HTMLInputElement>(null);
  if (!view) return null;

  const live = view.status === 'live';
  const mode: SpeakMode = speaker.locked ?? 'push';
  const speaking = currentSpeaker(speaker);
  const final = view.turns.filter((t) => t.final);
  const interim = view.turns.at(-1)?.final === false ? view.turns.at(-1)! : null;
  const first = view.prospect.name.split(' ')[0] || 'Prospect';
  const current = live ? view.current : null;
  const cueNo = current ? Math.max(1, view.history.findIndex((h) => h.suggestion.id === current.id) + 1 || view.history.length) : null;
  const words = (s: Speaker) => final.filter((t) => t.speaker === s).reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
  const repWords = words('rep');
  const allWords = repWords + words('prospect');
  const situation = view.situation;
  const stage = view.prospect.facts.stage ?? view.prospect.facts.funding;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    addTurn({ speaker: typedAs, text: t, final: true, tMs: Math.max(0, Date.now() - view.startedAt), via: 'typed' });
    setText('');
    input.current?.focus();
  };

  const popOut = async () => {
    const r = await openPip();
    if (r === 'blocked') toast({ tone: 'warn', title: 'Pop-out was blocked', description: 'Allow pop-ups for Cue, then try again.' });
  };

  return (
    <div className="cue-dash-grid web-live-grid">
      <Pane
        label="Transcript"
        hint="What's been said so far. If the mic misses something, type it below."
        meta={`${final.length} ${final.length === 1 ? 'turn' : 'turns'}`}
        actions={
          <>
            {connection !== 'live' && <ConnectionPill connection={connection} />}
            {queued > 0 && (
              <Chip size="sm" tone="warn">
                {queued} waiting
              </Chip>
            )}
            {capture.state === 'listening' && (
              <span className="web-rec" role="status">
                <span className="web-rec__dot" aria-hidden /> {speaking === 'rep' ? 'You' : first}
              </span>
            )}
          </>
        }
        pad="none"
        className="web-live-grid__transcript"
        footer={
          live ? (
            <div className="web-composer">
              {transcriber === 'webspeech' && (
                <div className="web-composer__mic">
                  <Button
                    size="sm"
                    variant={capture.state === 'listening' ? 'danger' : 'secondary'}
                    icon={capture.state === 'listening' ? 'mic-off' : 'mic'}
                    loading={capture.state === 'starting'}
                    onClick={() => (capture.state === 'listening' ? capture.stop() : void capture.start())}
                  >
                    {capture.state === 'listening' ? 'Stop mic' : 'Use mic'}
                  </Button>
                  <SegmentedControl<SpeakMode>
                    label="Mic is"
                    size="sm"
                    options={[
                      { value: 'push', label: 'Hold Space = you' },
                      { value: 'prospect', label: first },
                      { value: 'rep', label: 'You' },
                    ]}
                    value={mode}
                    onChange={(v) => dispatchSpeaker({ type: 'lock', speaker: v === 'push' ? null : v })}
                  />
                  {capture.state === 'listening' && (
                    <span className="web-level" aria-hidden>
                      <span className="web-level__fill" style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
                    </span>
                  )}
                </div>
              )}
              {capture.error && (
                <p className="web-note web-note--warn" role="alert">
                  <Icon name="alert" size={14} />
                  {capture.error}
                </p>
              )}
              <form className="web-composer__row" onSubmit={send}>
                <SegmentedControl<Speaker>
                  label="Typed turn from"
                  size="sm"
                  options={[
                    { value: 'prospect', label: first },
                    { value: 'rep', label: 'You' },
                  ]}
                  value={typedAs}
                  onChange={setTypedAs}
                />
                <span className="web-composer__input">
                  <label className="web-sr" htmlFor="say-input">
                    What was said
                  </label>
                  <input
                    id="say-input"
                    ref={input}
                    className="web-input"
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={typedAs === 'prospect' ? `What did ${first} say?` : 'What did you say?'}
                    autoComplete="off"
                  />
                  <IconButton icon="arrow-right" label="Add turn" type="submit" variant="primary" disabled={!text.trim()} />
                </span>
              </form>
            </div>
          ) : undefined
        }
      >
        <TranscriptView turns={final} interim={interim} highlightTurnId={view.current?.turnId} names={{ prospect: first }} maxHeight="none" label={null} />
      </Pane>

      <Pane
        label="Cue"
        meta={current && cueNo ? cueLabel(cueNo) : live ? (view.pending ? 'thinking' : 'listening') : view.outcome ? OUTCOME_LABEL[view.outcome.outcome] : 'ended'}
        hint={live ? 'The line to say next. Press Used if you said it (or U), Skip if not (D).' : undefined}
        actions={
          <>
            {current && <MomentChip moment={current.kind === 'compliance' ? 'compliance' : current.situation.moment} />}
            {current && situation && <span className="cue-label">{`${PERSONA_LABEL[situation.persona]}${current.servedBy === 'mubit' ? ` · by Mubit in ${(current.latencyMs / 1000).toFixed(1)} s` : ' · from the playbook'}`}</span>}
            <Button size="sm" variant="ghost" icon="external" onClick={() => void popOut()} disabled={pip} title={pipSupported() === 'document' ? 'Always-on-top window over any app' : 'Opens a small window'}>
              {pip ? 'Popped out' : 'Pop out'}
            </Button>
          </>
        }
        pad="none"
        className="web-live-grid__cue"
      >
        <CueStage view={view} onAction={bar.onAction} cardRef={bar.cardRef} debug={bar.debug} shortcuts variant="flush" />
        {current && current.upNext.length > 0 && (
          <div className="web-live-grid__standby">
            <UpNextList items={current.upNext} />
          </div>
        )}
        {view.lastError && live && (
          <p className="web-note web-live-grid__note" role="status">
            <Icon name="info" size={14} />
            {view.lastError.message}
          </p>
        )}
      </Pane>

      <Pane label="Prospect" meta={view.source === 'trellus' ? 'Trellus' : undefined} hint="Who you're talking to, Cue's read of them, and the research brief." pad="none" as="aside" className="web-live-grid__prospect">
        <div className="web-prospect">
          <h2 className="web-prospect__name">{view.prospect.name || view.prospect.company || 'Unnamed prospect'}</h2>
          <p className="cue-label">{[view.prospect.title, view.prospect.company].filter(Boolean).join(' · ') || 'No CRM details'}</p>
          <KeyValue
            items={[
              ...(stage ? [{ label: 'Stage', value: stage }] : []),
              ...(situation
                ? [
                    {
                      label: 'On the line',
                      value: (
                        <>
                          {PERSONA_LABEL[situation.persona]} <span className="cue-num web-muted web-small">{Math.round(situation.personaConfidence * 100)}%</span>
                        </>
                      ),
                    },
                    { label: 'Mood', value: <ReceptivityMeter score={situation.receptivityScore} trend={view.receptivityTrend} /> },
                  ]
                : []),
              ...(allWords > 0 ? [{ label: 'You talked', value: <Bar value={repWords / allWords} label={`${Math.round((repWords / allWords) * 100)}%`} tone="accent" /> }] : []),
              { label: 'Cues', value: <span className="cue-num">{`${view.history.filter((h) => h.action === 'used' || h.action === 'edited').length} used of ${view.history.length}`}</span> },
              ...(view.endedAt ? [{ label: 'Length', value: <span className="cue-num">{formatDuration(view.endedAt - view.startedAt)}</span> }] : []),
            ]}
          />
        </div>
        <PaneSection label="Brief" meta={view.brief ? `${view.brief.hooks.length} talking points` : live ? 'researching' : undefined}>
          <BriefView brief={view.brief} loading={!view.brief && live} />
        </PaneSection>
        <PaneSection label="Flags" meta={String(view.flags.length)} hint={view.flags.length ? undefined : 'Claims Cue checks against what you may promise. None so far.'}>
          <FlagsView flags={view.flags} />
        </PaneSection>
        <PaneSection label={live ? 'End the call' : 'After the call'}>
          {live ? (
            <OutcomeBar onOutcome={(o) => void endAndDebrief(o)} />
          ) : (
            <ActionBar>
              <Button variant="primary" icon="arrow-right" onClick={() => openDebrief(view.id)}>
                {view.feedback ? 'See the review' : 'Debrief'}
              </Button>
              <Button variant="ghost" icon="plus" onClick={detachCall}>
                New call
              </Button>
            </ActionBar>
          )}
        </PaneSection>
      </Pane>

      <Pane label="Call timeline" meta={view.history.length ? `${view.history.length} suggestions` : undefined} pad="none" scroll={false} className="web-live-grid__timeline">
        <CallTimeline view={view} />
      </Pane>
    </div>
  );
}
