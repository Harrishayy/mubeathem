import { OUTCOME_LABEL, PERSONA_LABEL, type Speaker } from '@cue/core';
import { Button, CallTimer, Chip, ConnectionPill, Icon, IconButton, OutcomeBar, SegmentedControl, Sprout, TranscriptView } from '@cue/ui';
import { mascotFor } from '@cue/core';
import { useRef, useState, type FormEvent } from 'react';
import { useCapture } from '../../capture/useCapture';
import { currentSpeaker, dispatchSpeaker, speakerStore } from '../../capture/speaker';
import { levelStore } from '../../capture/level';
import { demoStore } from '../../demo/runner';
import { navigate } from '../../router';
import { openPip, pipSupported } from '../../pip';
import { addTurn, callStore, detachCall } from '../../state/call';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { toast, uiStore } from '../../state/ui';
import { endAndDebrief } from '../../shell/useOverbar';

type SpeakMode = 'push' | 'prospect' | 'rep';

/** Below the overbar: the transcript, capture and a typed-turn composer. */
export function CallConsole() {
  const { view, connection, queued } = useStore(callStore);
  const speaker = useStore(speakerStore);
  const level = useStore(levelStore);
  const pip = useStore(uiStore, (u) => u.pip);
  const transcriber = useStore(settingsStore, (s) => s.transcriber);
  const demo = useStore(demoStore, (d) => d.status);
  const capture = useCapture(view?.startedAt ?? null);
  const [text, setText] = useState('');
  const [typedAs, setTypedAs] = useState<Speaker>('prospect');
  const input = useRef<HTMLInputElement>(null);
  if (!view) return null;

  const live = view.status === 'live';
  const demoOn = demo === 'running' || demo === 'paused' || demo === 'starting';
  const mode: SpeakMode = speaker.locked ?? 'push';
  const speaking = currentSpeaker(speaker);
  const final = view.turns.filter((t) => t.final);
  const interim = view.turns.at(-1)?.final === false ? view.turns.at(-1)! : null;
  const lastProspect = [...final].reverse().find((t) => t.speaker === 'prospect');

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
    <div className="web-console">
      <header className="web-console__head">
        <div className="web-console__who">
          <Sprout state={mascotFor(view, connection)} size={40} voiceLevel={speaking === 'prospect' ? level : 0} />
          <div className="web-console__names">
            <h1 className="web-h2 web-trunc">{view.prospect.name || view.prospect.company || 'Unnamed prospect'}</h1>
            <p className="web-muted web-small web-trunc">
              {[view.prospect.title, view.prospect.company].filter(Boolean).join(' · ') || 'No CRM details'}
              {view.situation && ` · reads as ${PERSONA_LABEL[view.situation.persona]}`}
            </p>
          </div>
        </div>
        <div className="web-console__meta">
          {connection !== 'live' && <ConnectionPill connection={connection} />}
          {queued > 0 && (
            <Chip size="sm" tone="warn" icon="wifi-off">
              {queued} waiting
            </Chip>
          )}
          {live ? (
            <Chip size="sm" tone="ok" icon="dot">
              <CallTimer startedAt={view.startedAt} endedAt={view.endedAt} />
            </Chip>
          ) : (
            <Chip size="sm" tone={view.outcome?.outcome === 'meeting_booked' ? 'ok' : 'neutral'} icon={view.outcome?.outcome === 'meeting_booked' ? 'calendar' : 'check'}>
              {view.outcome ? OUTCOME_LABEL[view.outcome.outcome] : 'Ended'}
            </Chip>
          )}
          <Button size="sm" variant="secondary" icon="external" onClick={() => void popOut()} disabled={pip} title={pipSupported() === 'document' ? 'Always-on-top window over any app' : 'Opens a small window'}>
            {pip ? 'Popped out' : 'Pop out'}
          </Button>
        </div>
      </header>

      <div className="web-console__grid">
        <section className="web-panel web-console__transcript" aria-label="Transcript">
          <div className="web-panel__head">
            <h2 className="web-h3">Transcript</h2>
            <span className="web-muted web-small">{final.length} turns</span>
          </div>
          <TranscriptView turns={final} interim={interim} highlightTurnId={view.current?.turnId} names={{ prospect: view.prospect.name.split(' ')[0] || 'Prospect' }} maxHeight="min(52vh, 520px)" />
        </section>

        <aside className="web-console__side">
          {live && (
            <section className="web-panel" aria-labelledby="capture-title">
              <div className="web-panel__head">
                <h2 className="web-h3" id="capture-title">
                  Capture
                </h2>
                {capture.state === 'listening' && (
                  <span className="web-rec" role="status">
                    <span className="web-rec__dot" aria-hidden /> Listening as {speaking === 'rep' ? 'you' : 'the prospect'}
                  </span>
                )}
              </div>
              {transcriber === 'webspeech' && !demoOn && (
                <div className="web-capture">
                  <Button
                    variant={capture.state === 'listening' ? 'danger' : 'primary'}
                    icon={capture.state === 'listening' ? 'mic-off' : 'mic'}
                    loading={capture.state === 'starting'}
                    onClick={() => (capture.state === 'listening' ? capture.stop() : void capture.start())}
                    block
                  >
                    {capture.state === 'listening' ? 'Stop the mic' : 'Use the mic'}
                  </Button>
                  <SegmentedControl<SpeakMode>
                    label="Mic is"
                    size="sm"
                    options={[
                      { value: 'push', label: 'Hold Space = you' },
                      { value: 'prospect', label: 'Prospect' },
                      { value: 'rep', label: 'You' },
                    ]}
                    value={mode}
                    onChange={(v) => dispatchSpeaker({ type: 'lock', speaker: v === 'push' ? null : v })}
                  />
                  <div className="web-level" aria-hidden>
                    <span className="web-level__fill" style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
                  </div>
                  {capture.error && (
                    <p className="web-note web-note--warn" role="alert">
                      <Icon name="alert" size={14} />
                      {capture.error}
                    </p>
                  )}
                </div>
              )}
              <form className="web-say" onSubmit={send}>
                <SegmentedControl<Speaker>
                  label="Typed turn from"
                  size="sm"
                  options={[
                    { value: 'prospect', label: 'Prospect' },
                    { value: 'rep', label: 'You' },
                  ]}
                  value={typedAs}
                  onChange={setTypedAs}
                />
                <div className="web-say__row">
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
                    placeholder={typedAs === 'prospect' ? 'What did they say?' : 'What did you say?'}
                    autoComplete="off"
                    disabled={demoOn}
                  />
                  <IconButton icon="arrow-right" label="Add turn" type="submit" variant="primary" disabled={!text.trim() || demoOn} />
                </div>
                {lastProspect && <p className="web-muted web-small web-trunc">Last from them: “{lastProspect.text}”</p>}
              </form>
            </section>
          )}

          <section className="web-panel" aria-labelledby="outcome-title">
            <div className="web-panel__head">
              <h2 className="web-h3" id="outcome-title">
                {live ? 'End the call' : 'Call ended'}
              </h2>
            </div>
            {live ? (
              <OutcomeBar onOutcome={(o) => void endAndDebrief(o)} />
            ) : (
              <div className="web-row">
                <Button variant="primary" icon="arrow-right" onClick={() => navigate({ name: 'debrief', id: view.id })}>
                  {view.feedback ? 'See the review' : 'Debrief'}
                </Button>
                <Button variant="ghost" icon="plus" onClick={detachCall}>
                  New call
                </Button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
