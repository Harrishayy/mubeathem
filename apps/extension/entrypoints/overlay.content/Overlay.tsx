import { OUTCOME_LABEL, type SuggestionAction } from '@cue/core';
import { Button, CueRoot, IconButton, Overbar, type OverbarMode, type SuggestionCardHandle } from '@cue/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostId } from '../../src/hosts';
import { request } from '../../src/messages';
import type { PageReading } from '../../src/ui/PageWatcher';
import { useCardShortcuts } from '../../src/ui/useCardShortcuts';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';
import { popOut, popOutAvailable } from './pip';

export interface OverlayProps {
  host: HostId;
  /** Latest reading of this page; the content script re-renders on change. */
  reading: PageReading | null;
  /** This tab's id, learned from the background (null until it answers). */
  tabId: number | null;
  /** The overlay's shadow root: card shortcuts are heard only when focus is inside Cue. */
  shadow?: ShadowRoot | null;
}

/**
 * Cue on the dialer page: the overbar pinned to the top (collapsed by default, draggable sideways), and
 * a small pane under it that offers to start Cue for the contact read from the page, or says what Cue
 * needs. Nothing to fill in: details are fixed in HubSpot or the Cue app. The bar can pop out into an
 * always-on-top window. It follows the side panel's look. Escape collapses it.
 */
export function Overlay({ host, reading, tabId, shadow }: OverlayProps) {
  const { state, levels, connected } = useSession();
  const [settings] = useSettings();
  const [mode, setMode] = useState<OverbarMode>('collapsed');
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The capture message the rep closed; a different message shows again. */
  const [hiddenCapture, setHiddenCapture] = useState<string | null>(null);
  const cardRef = useRef<SuggestionCardHandle>(null);
  const scope = useCallback(() => shadow ?? null, [shadow]);
  useCardShortcuts(cardRef, scope);

  // Escape collapses the panel and keeps focus in Cue on the expand button. The overbar collapses on
  // Escape by itself too; this adds the focus return.
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
      }
    };
    shadow.addEventListener('keydown', onKey);
    return () => shadow.removeEventListener('keydown', onKey);
  }, [shadow, mode]);

  const prospect = reading?.prospect ?? null;
  const trellusState = reading?.trellus.state ?? 'none';
  const mine = state.tabId === null || tabId === null || state.tabId === tabId;
  const onCall = (state.phase === 'live' || state.phase === 'starting' || state.phase === 'ended') && mine;
  const contactKey = `${prospect?.name ?? ''}|${prospect?.phone ?? ''}`;

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
      {showOffer && (
        <div className="cxo-row">
          <div className="cxo-who">
            <span className="cxo-name">{prospect!.name || prospect!.phone || 'Unknown contact'}</span>
            {(prospect!.title || prospect!.company) && <span className="cxo-meta">{[prospect!.title, prospect!.company].filter(Boolean).join(' · ')}</span>}
          </div>
          <div className="cxo-actions">
            <Button variant="primary" size="sm" icon="spark" loading={busy} onClick={() => void start()}>
              Start Cue
            </Button>
            <IconButton icon="close" label="Not now" size="sm" onClick={() => setDismissedFor(contactKey)} />
          </div>
        </div>
      )}
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
          <span className="cxo-note">{endedWords(state.view?.outcome)}</span>
          <div className="cxo-actions">
            <Button size="sm" variant="primary" onClick={() => void request({ type: 'panel.open' })}>
              See the wrap-up
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void request({ type: 'session.reset' })}>
              Next call
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
        onPopOut={onCall && state.phase !== 'ended' && popOutAvailable() ? () => void popOut(shadow ?? null) : undefined}
        placement="top"
        voiceLevel={levels.prospect}
        cardRef={cardRef}
        accessory={accessory}
      />
    </CueRoot>
  );
}

function endedWords(o: { outcome: keyof typeof OUTCOME_LABEL; source: string } | null | undefined): string {
  if (!o) return 'Call ended. Cue is waiting for the outcome from Trellus.';
  const from = o.source === 'trellus' ? ' (from Trellus)' : o.source === 'hubspot' ? ' (from HubSpot)' : '';
  return `${OUTCOME_LABEL[o.outcome]}${from}. The wrap-up is in the side panel.`;
}

function captureMessage(c: { tab: { state: string; message?: string }; mic: { state: string; message?: string } }): string | null {
  const bad = (s: string) => s === 'denied' || s === 'error';
  if (bad(c.tab.state)) return c.tab.message ?? "Cue can't hear the call tab.";
  if (bad(c.mic.state)) return c.mic.message ?? "Cue can't hear your microphone.";
  return null;
}
