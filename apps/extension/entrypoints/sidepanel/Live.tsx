import type { Prospect, Speaker, SuggestionAction } from '@cue/core';
import { Button, Chip, Icon, OutcomeBar, Overbar, SegmentedControl, TextField, type ChipTone, type OverbarMode, type SuggestionCardHandle } from '@cue/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { request, type CaptureStatus } from '../../src/messages';
import type { Settings } from '../../src/settings';
import type { SessionHook } from '../../src/ui/useSession';
import { useCardShortcuts } from '../../src/ui/useCardShortcuts';
import { MicPermission } from './MicPermission';

async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

const docScope = () => document;

const CAPTURE_TONE: Record<CaptureStatus['state'], ChipTone> = { off: 'neutral', starting: 'info', on: 'ok', unavailable: 'warn', denied: 'bad', error: 'bad' };
const CAPTURE_WORD: Record<CaptureStatus['state'], string> = { off: 'off', starting: 'starting', on: 'on', unavailable: 'not transcribed', denied: 'blocked', error: 'error' };

export function Live({ session, settings, onOpenSettings }: { session: SessionHook; settings: Settings; onOpenSettings: () => void }) {
  const { state, levels } = session;
  const [mode, setMode] = useState<OverbarMode>('expanded');
  const cardRef = useRef<SuggestionCardHandle>(null);
  useCardShortcuts(cardRef, docScope, state.phase === 'live');
  const onAction = useCallback((suggestionId: string, action: SuggestionAction, text?: string) => {
    void request({ type: 'session.action', suggestionId, action, ...(text ? { text } : {}) });
  }, []);

  return (
    <div className="sp-live">
      {state.error && (
        <p className="sp-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{state.error}</span>
        </p>
      )}
      {state.phase === 'idle' ? (
        <StartCall page={state.page?.prospect ?? null} settings={settings} onOpenSettings={onOpenSettings} />
      ) : (
        <>
          <Overbar
            view={state.view}
            connection={state.connection}
            mode={mode}
            onModeChange={setMode}
            onAction={onAction}
            onEnd={() => void request({ type: 'session.end' })}
            onOpenSettings={onOpenSettings}
            placement="inline"
            voiceLevel={levels.prospect}
            drawers={{ transcript: true }}
            cardRef={cardRef}
          />
          {state.pendingTurns > 0 && (
            <p className="sp-hint" role="status">
              <Icon name="wifi-off" size={14} /> {state.pendingTurns} {state.pendingTurns === 1 ? 'turn' : 'turns'} waiting for the server
            </p>
          )}
          <CaptureRow state={state} />
          <Composer disabled={state.phase !== 'live' && state.phase !== 'starting'} />
          {state.phase === 'live' && (
            <section className="sp-section" aria-label="End the call">
              <h2 className="sp-label">How did it end?</h2>
              <OutcomeBar onOutcome={(outcome) => void request({ type: 'session.end', outcome })} value={state.view?.outcome?.outcome ?? null} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CaptureRow({ state }: { state: SessionHook['state'] }) {
  const { tab, mic } = state.capture;
  const tabTranscribed = tab.state === 'on';
  const problem = [tab, mic].find((c) => c.state === 'denied' || c.state === 'error' || c.state === 'unavailable');
  return (
    <section className="sp-section sp-capture" aria-label="Audio">
      <div className="sp-chips">
        <Chip size="sm" tone={CAPTURE_TONE[tab.state]} icon="phone">
          Prospect audio {CAPTURE_WORD[tab.state]}
        </Chip>
        <Chip size="sm" tone={CAPTURE_TONE[mic.state]} icon={mic.state === 'on' ? 'mic' : 'mic-off'}>
          Your mic {CAPTURE_WORD[mic.state]}
        </Chip>
        {(tab.state !== 'on' || mic.state !== 'on') && (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void request({ type: 'capture.retry' })}>
            Retry
          </Button>
        )}
      </div>
      {problem?.message && <p className="sp-hint">{problem.message}</p>}
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
    </section>
  );
}

/** Typed turns: the fallback when capture is denied, and handy for demos. */
function Composer({ disabled }: { disabled: boolean }) {
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
    <form className="sp-section sp-composer" onSubmit={send} aria-label="Type a turn">
      <SegmentedControl<Speaker>
        label="Who said it"
        size="sm"
        value={speaker}
        onChange={setSpeaker}
        options={[
          { value: 'prospect', label: 'Prospect' },
          { value: 'rep', label: 'Me' },
        ]}
      />
      <div className="sp-composer__row">
        <TextField ref={input} label="Type what was said" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} disabled={disabled} error={error} placeholder={speaker === 'prospect' ? "What's this regarding?" : 'Your line'} />
        <Button type="submit" variant="secondary" disabled={disabled || !text.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

function StartCall({ page, settings, onOpenSettings }: { page: Prospect | null; settings: Settings; onOpenSettings: () => void }) {
  const [p, setP] = useState({ name: '', title: '', company: '', phone: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the page's contact until the rep edits a field.
  useEffect(() => {
    if (!touched && page) setP({ name: page.name, title: page.title, company: page.company, phone: page.phone ?? '' });
  }, [page, touched]);

  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouched(true);
    setP({ ...p, [k]: e.target.value });
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const prospect: Prospect = {
      ...(page && !touched ? page : { facts: {} }),
      name: p.name.trim(),
      title: p.title.trim(),
      company: p.company.trim(),
      ...(p.phone.trim() ? { phone: p.phone.trim() } : {}),
      facts: page?.facts ?? {},
    };
    const res = await request({ type: 'session.start', prospect, tabId: await activeTabId(), source: 'cue' });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <form className="sp-start" onSubmit={start}>
      <div className="sp-start__head">
        <h1 className="sp-title">Next call</h1>
        <p className="sp-hint">{page ? 'Read from the page. Edit anything that looks off.' : 'Open the contact in HubSpot, or type who you are calling.'}</p>
      </div>
      <div className="sp-grid">
        <TextField label="Name" value={p.name} onChange={set('name')} maxLength={200} autoComplete="off" />
        <TextField label="Title" value={p.title} onChange={set('title')} maxLength={200} optional autoComplete="off" />
        <TextField label="Company" value={p.company} onChange={set('company')} maxLength={200} optional autoComplete="off" />
        <TextField label="Phone" value={p.phone} onChange={set('phone')} maxLength={40} optional inputMode="tel" autoComplete="off" />
      </div>
      {error && (
        <p className="sp-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
      <Button type="submit" variant="primary" icon="spark" block loading={busy} disabled={!p.name.trim() && !p.phone.trim()}>
        Start Cue
      </Button>
      <MicPermission />
      <p className="sp-hint">
        Talking to <code>{settings.serverUrl}</code>.{' '}
        <button type="button" className="sp-link" onClick={onOpenSettings}>
          Change
        </button>
      </p>
    </form>
  );
}
