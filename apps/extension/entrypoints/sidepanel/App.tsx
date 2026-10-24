import type { TrellusStatusResponse } from '@cue/core';
import { CallTimer, CueMark, CueRoot, Icon, Skeleton } from '@cue/ui';
import { useCallback, useEffect, useState } from 'react';
import { request, type HealthSummary, type SessionState } from '../../src/messages';
import { webAppRoute } from '../../src/settings';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';
import { Connect } from './Connect';
import { Live } from './Live';
import { Ready } from './Ready';
import { Wrap } from './Wrap';

type Health = { state: 'checking' } | { state: 'ok'; health: HealthSummary } | { state: 'down'; message: string };

/**
 * The side panel: a companion, not a form. It follows the call by itself: the brief while Trellus
 * dials (Ready), the line and the transcript on the call (Live), the outcome and the review after it
 * (Wrap). The only thing it ever asks is where the server is, and only when it can't reach it. Every
 * other setting lives in the Cue app.
 */
export function App() {
  const session = useSession();
  const [settings, update] = useSettings();
  const [health, setHealth] = useState<Health>({ state: 'checking' });
  const [trellus, setTrellus] = useState<TrellusStatusResponse | null>(null);

  const check = useCallback(async () => {
    const res = await request<HealthSummary>({ type: 'server.health' });
    setHealth(res.ok ? { state: 'ok', health: res.data } : { state: 'down', message: res.error });
    if (res.ok) {
      const t = await request<TrellusStatusResponse>({ type: 'trellus.status' });
      setTrellus(t.ok ? t.data : null);
    }
  }, []);

  useEffect(() => {
    if (settings) void check();
  }, [settings?.serverUrl, settings?.token, check]); // eslint-disable-line react-hooks/exhaustive-deps

  const { state } = session;
  const ready = !!settings && session.connected;
  const onCall = state.phase !== 'idle';

  return (
    <CueRoot direction={settings?.direction ?? 'honey'} theme={settings?.theme ?? 'system'} density="comfortable" className="sp-root">
      <header className="sp-head">
        <CueMark size={20} />
        <span className="sp-head__word">Cue</span>
        <Status state={state} connected={session.connected} />
        <span className="sp-head__fill" />
        <TrellusChip status={trellus} onPage={!!state.page?.trellus.present} />
      </header>
      {!ready || (health.state === 'checking' && !onCall) ? (
        <main className="sp-main" aria-busy="true">
          <Skeleton height={56} />
          <Skeleton lines={4} />
        </main>
      ) : health.state === 'down' && !onCall ? (
        <Connect
          settings={settings!}
          update={update}
          problem={`Cue can't reach its server at ${settings!.serverUrl}. ${health.message}`}
          onConnected={() => void check()}
        />
      ) : state.phase === 'idle' ? (
        <Ready state={state} settings={settings!} />
      ) : state.phase === 'ended' ? (
        <Wrap state={state} settings={settings!} />
      ) : (
        <Live session={session} />
      )}
      {settings && (
        <p className="sp-foot">
          <span className="sp-foot__keys">
            <kbd className="sp-kbd">Alt</kbd>
            <kbd className="sp-kbd">Shift</kbd>
            <kbd className="sp-kbd">C</kbd> bar on the page
          </span>
          <a className="sp-link" href={webAppRoute(settings, 'settings')} target="_blank" rel="noreferrer">
            Settings in Cue
            <Icon name="external" size={12} />
            <span className="cue-vh"> (opens the Cue app in a new tab)</span>
          </a>
        </p>
      )}
    </CueRoot>
  );
}

function Status({ state, connected }: { state: SessionState; connected: boolean }) {
  if (!connected) return <span className="sp-head__status is-warn">Connecting</span>;
  if (state.connection === 'offline') return <span className="sp-head__status is-warn">Offline</span>;
  if (state.connection === 'reconnecting') return <span className="sp-head__status is-warn">Reconnecting</span>;
  if (state.phase === 'starting') return <span className="sp-head__status is-live">Starting</span>;
  if (state.phase === 'live')
    return (
      <span className="sp-head__status is-live">
        <span className="sp-head__dot" aria-hidden />
        Live {state.view && <CallTimer startedAt={state.view.startedAt} endedAt={null} />}
      </span>
    );
  if (state.phase === 'ended') return <span className="sp-head__status">Ended</span>;
  const t = state.page?.trellus.state;
  if (t === 'dialing') return <span className="sp-head__status is-ring">Ringing</span>;
  return <span className="sp-head__status">Ready</span>;
}

/** Whether Cue's server is connected to Trellus (outcomes, transcripts after the call). */
function TrellusChip({ status, onPage }: { status: TrellusStatusResponse | null; onPage: boolean }) {
  const synced = !!status?.configured && status.reachable !== false;
  const word = synced ? 'synced' : status?.configured ? 'not reachable' : onPage ? 'on this page' : 'not connected';
  return (
    <span className={`sp-head__chip${synced ? ' is-on' : ''}`} title={synced ? 'Outcomes and transcripts come from Trellus after each call' : 'Connect Trellus in the Cue app to get outcomes automatically'}>
      Trellus · {word}
    </span>
  );
}
