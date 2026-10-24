import type { Prospect, SuggestionAction } from '@cue/core';
import { Button, CueRoot, IconButton, Overbar, TextField, type OverbarMode, type SuggestionCardHandle } from '@cue/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { applyOverride } from '../../src/context/contact';
import type { HostId } from '../../src/hosts';
import { request } from '../../src/messages';
import type { PageReading } from '../../src/ui/PageWatcher';
import { useCardShortcuts } from '../../src/ui/useCardShortcuts';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';

export interface OverlayProps {
  host: HostId;
  /** Latest reading of this page; the content script re-renders on change. */
  reading: PageReading | null;
  /** This tab's id, learned from the background (null until it answers). */
  tabId: number | null;
  /** The overlay's shadow root: card shortcuts are heard only when focus is inside Cue. */
  shadow?: ShadowRoot | null;
}

type Override = Partial<Pick<Prospect, 'name' | 'title' | 'company' | 'phone'>>;

/**
 * Cue on the dialer page: the overbar pinned to the top (collapsed by default, draggable sideways), and
 * a small pane under it that offers to start Cue (with the contact read from the page, editable), or
 * explains what Cue needs. It follows the side panel's look. Escape collapses it.
 */
export function Overlay({ host, reading, tabId, shadow }: OverlayProps) {
  const { state, levels, connected } = useSession();
  const [settings] = useSettings();
  const [mode, setMode] = useState<OverbarMode>('collapsed');
  const [override, setOverride] = useState<Override | null>(null);
  const [editing, setEditing] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The capture message the rep closed; a different message shows again. */
  const [hiddenCapture, setHiddenCapture] = useState<string | null>(null);
  const cardRef = useRef<SuggestionCardHandle>(null);
  const scope = useCallback(() => shadow ?? null, [shadow]);
  useCardShortcuts(cardRef, scope);

  // Escape collapses the panel and keeps focus in Cue on the expand button, or closes the contact
  // form. The overbar collapses on Escape by itself too; this adds the focus return and the form.
  useEffect(() => {
    if (!shadow) return;
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key !== 'Escape' || k.defaultPrevented) return;
      if (mode === 'expanded') {
        k.preventDefault();
        setMode('collapsed');
        // Focus was inside the panel that just closed: keep it in Cue, on the expand button.
        requestAnimationFrame(() => shadow.querySelector<HTMLElement>('.cue-bar__toggle')?.focus());
      } else if (editing) {
        k.preventDefault();
        setEditing(false);
      }
    };
    shadow.addEventListener('keydown', onKey);
    return () => shadow.removeEventListener('keydown', onKey);
  }, [shadow, mode, editing]);

  const prospect = useMemo(() => applyOverride(reading?.prospect ?? null, override), [reading?.prospect, override]);
  const trellusState = reading?.trellus.state ?? 'none';
  const mine = state.tabId === null || tabId === null || state.tabId === tabId;
  const onCall = (state.phase === 'live' || state.phase === 'starting' || state.phase === 'ended') && mine;
  const contactKey = `${prospect?.name ?? ''}|${prospect?.phone ?? ''}`;

  // A new contact (next dial) clears the manual edit and the dismissal.
  useEffect(() => {
    setOverride(null);
    setEditing(false);
  }, [reading?.url]);

  const start = useCallback(async () => {
    if (!prospect) return;
    setBusy(true);
    setNote(null);
    const res = await request({ type: 'session.start', prospect, tabId, source: reading?.trellus.present ? 'trellus' : 'cue' });
    setBusy(false);
    if (!res.ok) setNote(res.error);
  }, [prospect, tabId, reading?.trellus.present]);

  const onAction = useCallback((suggestionId: string, action: SuggestionAction, text?: string) => {
    void request({ type: 'session.action', suggestionId, action, ...(text ? { text } : {}) });
  }, []);

  if (!settings || !settings.overlay || !settings.hosts[host]) return null;

  const view = onCall ? state.view : null;
  const connection = onCall ? state.connection : connected ? 'live' : 'reconnecting';
  const showOffer = !onCall && state.phase === 'idle' && !!prospect && dismissedFor !== contactKey;
  const capture = onCall && state.phase !== 'ended' ? captureMessage(state.capture) : null;
  const captureNote = capture && capture !== hiddenCapture ? capture : null;

  const hasCard = mode === 'collapsed' && (showOffer || !!captureNote || (state.phase === 'ended' && mine) || !!note);
  const accessory = hasCard ? (
    <section className="cxo-card" aria-label="Cue">
      <header className="cxo-head">
        <span className="cue-label cxo-kicker">{onCall ? (state.phase === 'ended' ? 'Call ended' : 'On a call') : trellusState === 'connected' ? 'Trellus connected' : trellusState === 'dialing' ? 'Trellus dialling' : 'Ready to call'}</span>
      </header>
      <div className="cxo-body">
      {showOffer && !editing && (
        <div className="cxo-row">
          <div className="cxo-who">
            <span className="cxo-name">{prospect!.name || prospect!.phone || 'Unknown contact'}</span>
            {(prospect!.title || prospect!.company) && <span className="cxo-meta">{[prospect!.title, prospect!.company].filter(Boolean).join(' · ')}</span>}
          </div>
          <div className="cxo-actions">
            <IconButton icon="edit" label="Edit contact" size="sm" onClick={() => setEditing(true)} />
            <Button variant="primary" size="sm" icon="spark" loading={busy} onClick={() => void start()}>
              Start Cue
            </Button>
            <IconButton icon="close" label="Not now" size="sm" onClick={() => setDismissedFor(contactKey)} />
          </div>
        </div>
      )}
      {showOffer && editing && <ContactForm initial={prospect!} onCancel={() => setEditing(false)} onSave={(o) => (setOverride(o), setEditing(false))} />}
      {captureNote && (
        <div className="cxo-row cxo-row--note" role="status">
          <span className="cxo-note">{captureNote}</span>
          <div className="cxo-actions">
            <Button size="sm" variant="secondary" onClick={() => void request({ type: 'capture.retry' })}>
              Retry
            </Button>
            <IconButton icon="close" label="Hide this" size="sm" onClick={() => setHiddenCapture(captureNote)} />
          </div>
        </div>
      )}
      {state.phase === 'ended' && mine && (
        <div className="cxo-row">
          <span className="cxo-note">{state.view?.outcome?.outcome === 'meeting_booked' ? 'Booked. Twenty seconds of debrief teaches Cue what worked.' : 'Call ended. A quick debrief teaches Cue what worked.'}</span>
          <div className="cxo-actions">
            <Button size="sm" variant="primary" onClick={() => void request({ type: 'panel.open' })}>
              Debrief
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void request({ type: 'session.reset' })}>
              Skip
            </Button>
          </div>
        </div>
      )}
      {note && (
        <div className="cxo-row cxo-row--note" role="alert">
          <span className="cxo-note">{note}</span>
          <IconButton icon="close" label="Dismiss" size="sm" onClick={() => setNote(null)} />
        </div>
      )}
      </div>
    </section>
  ) : null;

  return (
    <CueRoot direction={settings.direction} theme={settings.theme} density="comfortable">
      <Overbar
        view={view}
        connection={connection}
        mode={mode}
        onModeChange={setMode}
        onAction={onAction}
        onEnd={() => void request({ type: 'session.end' })}
        onOpenSettings={() => void request({ type: 'panel.open' })}
        placement="top"
        voiceLevel={levels.prospect}
        cardRef={cardRef}
        accessory={accessory}
      />
    </CueRoot>
  );
}

function captureMessage(c: { tab: { state: string; message?: string }; mic: { state: string; message?: string } }): string | null {
  const bad = (s: string) => s === 'denied' || s === 'error';
  if (bad(c.tab.state)) return c.tab.message ?? "Cue can't hear the call tab.";
  if (bad(c.mic.state)) return c.mic.message ?? "Cue can't hear your microphone.";
  return null;
}

function ContactForm({ initial, onSave, onCancel }: { initial: Prospect; onSave: (o: Override) => void; onCancel: () => void }) {
  const [f, setF] = useState<Override>({ name: initial.name, title: initial.title, company: initial.company, phone: initial.phone ?? '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(f);
  };
  return (
    <form className="cxo-form" onSubmit={submit}>
      <TextField label="Name" value={f.name ?? ''} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      <TextField label="Title" value={f.title ?? ''} maxLength={200} optional onChange={(e) => setF({ ...f, title: e.target.value })} />
      <TextField label="Company" value={f.company ?? ''} maxLength={200} optional onChange={(e) => setF({ ...f, company: e.target.value })} />
      <TextField label="Phone" value={f.phone ?? ''} maxLength={40} optional inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <div className="cxo-actions cxo-actions--end">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Use these details
        </Button>
      </div>
    </form>
  );
}
