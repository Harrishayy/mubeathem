import type { CallView, Speaker, SuggestionAction } from '@cue/core';
import { Button, CueStage, Icon, IconButton, SegmentedControl, Skeleton, UpNextList, VisuallyHidden, type SuggestionCardHandle } from '@cue/ui';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { request, type CaptureStatus, type SessionState } from '../../src/messages';
import type { SessionHook } from '../../src/ui/useSession';
import { useCardShortcuts } from '../../src/ui/useCardShortcuts';
import { role } from '../../src/ui/format';
import { MicPermission } from './MicPermission';
import { BesideNote, HookList, Section, SourceList, Transcript, Who, firstName, useBeside } from './parts';

const docScope = () => document;

/**
 * On the call, in one glance: who's on the line (and how open they are), the line to say now with what
 * to say if they go another way, the transcript as it happens, and the research one click from opening
 * beside the call. Listening and ending the call sit in the pinned bar.
 */
export function Live({ session }: { session: SessionHook }) {
  const { state } = session;
  const cardRef = useRef<SuggestionCardHandle>(null);
  useCardShortcuts(cardRef, docScope, state.phase === 'live');
  const beside = useBeside();
  const [showSources, setShowSources] = useState(false);
  const onAction = useCallback((suggestionId: string, action: SuggestionAction, text?: string) => {
    void request({ type: 'session.action', suggestionId, action, ...(text ? { text } : {}) });
  }, []);

  const view = state.view;
  const first = view ? firstName(view.prospect.name) : 'Prospect';
  const hooks = view?.brief?.hooks ?? [];

  return (
    <>
      {view ? <Who name={view.prospect.name || view.prospect.company} role={role(view.prospect)} view={view} /> : <Who name={state.page?.prospect?.name ?? 'Starting'} role={null} />}
      <main className="sp-main sp-main--live">
        {state.error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{state.error}</span>
          </p>
        )}
        <CaptureNote state={state} />
        {view ? <LineCard view={view} onAction={onAction} cardRef={cardRef} /> : <StartingCard />}

        <Section label="Transcript" meta={view ? `live · ${view.turns.filter((t) => t.final).length} turns` : undefined} className="sp-sec--grow">
          {view ? <Transcript view={view} first={first} /> : <Skeleton lines={3} />}
          {view && <Composer first={first} capture={state.capture} />}
        </Section>

        <Section
          label="Research"
          meta={view?.brief ? `${hooks.length} findings` : 'researching'}
          className="sp-sec--tray"
          action={
            view?.brief?.sources?.some((s) => s.url) ? (
              <button type="button" className="sp-textbtn" aria-expanded={showSources} onClick={() => setShowSources((v) => !v)}>
                {showSources ? 'Hide sources' : 'All sources'}
              </button>
            ) : undefined
          }
        >
          {view?.brief ? (
            showSources ? <SourceList sources={view.brief.sources ?? []} beside={beside} /> : <HookList hooks={hooks} beside={beside} limit={2} />
          ) : (
            <Skeleton lines={2} />
          )}
          <BesideNote beside={beside} />
        </Section>
      </main>
      <footer className="sp-dock" aria-label="Call actions">
        <LiveActions state={state} />
      </footer>
    </>
  );
}

function StartingCard() {
  return (
    <div className="sp-card sp-linecard" aria-busy="true">
      <span className="cue-label">Starting the call</span>
      <Skeleton lines={2} height={20} />
    </div>
  );
}

/** The line to say now (the shared card: say it, skip it, edit it), then what to do if they go elsewhere. */
function LineCard({ view, onAction, cardRef }: { view: CallView; onAction: (id: string, a: SuggestionAction, text?: string) => void; cardRef: React.RefObject<SuggestionCardHandle | null> }) {
  const current = view.status === 'live' ? view.current : null;
  return (
    <section className="sp-linecard" aria-label="Say next">
      <CueStage view={view} onAction={onAction} cardRef={cardRef} shortcuts />
      {current && current.upNext.length > 0 && (
        <div className="sp-standby">
          <UpNextList items={current.upNext} />
        </div>
      )}
      {view.lastError && (
        <p className="sp-inline-note" role="status">
          {view.lastError.message}
        </p>
      )}
    </section>
  );
}

/** One quiet line when Cue can't hear a side of the call, with the fix. Nothing when it can. */
function CaptureNote({ state }: { state: SessionState }) {
  const { tab, mic } = state.capture;
  const bad = (c: CaptureStatus) => c.state === 'denied' || c.state === 'error' || c.state === 'unavailable';
  const problem = bad(tab) ? tab : bad(mic) ? mic : null;
  if (!problem) return null;
  return (
    <div className="sp-banner sp-banner--soft" role="status">
      <Icon name={problem === mic ? 'mic-off' : 'alert'} size={16} />
      <div className="sp-banner__body">
        <span>{problem.message ?? (problem === tab ? "Cue can't hear the call tab." : "Cue can't hear your microphone.")}</span>
        {mic.state === 'denied' && <MicPermission compact />}
        {tab.state !== 'on' && mic.state === 'on' && (
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
      </div>
      <Button size="sm" variant="secondary" onClick={() => void request({ type: 'capture.retry' })}>
        Retry
      </Button>
    </div>
  );
}

/** Typed turns: only when Cue can't hear both sides, and folded until asked for. */
function Composer({ first, capture }: { first: string; capture: SessionState['capture'] }) {
  const hearing = capture.tab.state === 'on' && capture.mic.state === 'on';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState<Speaker>('prospect');
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  if (hearing && !open) return null;
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
  if (!open)
    return (
      <button type="button" className="sp-textbtn sp-composer__open" onClick={() => setOpen(true)}>
        Can't hear the call? Type what was said
      </button>
    );
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
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'sp-say-error' : undefined}
        />
        <IconButton icon="arrow-right" label="Add turn" type="submit" variant="primary" disabled={!text.trim()} />
      </span>
      {error && (
        <p id="sp-say-error" className="sp-inline-note sp-inline-note--warn" role="alert">
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
    <div className="sp-dock__row">
      <Button variant="secondary" icon={listening ? 'mic-off' : 'mic'} loading={busy === 'listen'} onClick={() => void run('listen')} disabled={state.phase !== 'live'}>
        {listening ? 'Stop listening' : 'Listen'}
      </Button>
      <span className="sp-dock__hint">{state.page?.trellus.present ? "Ends by itself when you hang up in Trellus" : null}</span>
      <Button variant="danger" icon="phone-off" loading={busy === 'end'} onClick={() => void run('end')}>
        End call
      </Button>
    </div>
  );
}
