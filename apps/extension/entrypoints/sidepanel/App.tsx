import { AppBar, BandTag, CueRoot, Skeleton, type AppTab } from '@cue/ui';
import { useEffect, useState } from 'react';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';
import { DispositionsScreen } from './Dispositions';
import { Live } from './Live';
import { SettingsScreen } from './Settings';

type Tab = 'live' | 'dispositions' | 'settings';
const TABS: Tab[] = ['live', 'dispositions', 'settings'];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.includes(h) ? h : 'live';
}

/**
 * The side panel: the dashboard band with compact tabs, then stacked panes. Live is this call only:
 * who you're calling (a saved contact or the page's prospect), then the cue, brief, last time,
 * prospect and transcript, with the debrief as a dialog over it after the call;
 * Dispositions maps Trellus dispositions to outcomes; Settings is the server, Trellus and the look.
 */
export function App() {
  const session = useSession();
  const [settings, update] = useSettings();
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', t === 'live' ? '#' : `#${t}`);
  };

  const { state } = session;
  const onCall = state.phase === 'live' || state.phase === 'starting';
  const tabs: AppTab[] = [
    { id: 'live', label: 'Call', href: '#', live: onCall },
    { id: 'dispositions', label: 'Dispositions', href: '#dispositions' },
    { id: 'settings', label: 'Settings', href: '#settings' },
  ];

  const status = !session.connected ? (
    <BandTag tone="warn">Connecting</BandTag>
  ) : state.connection === 'offline' ? (
    <BandTag tone="warn">Offline</BandTag>
  ) : state.connection === 'reconnecting' ? (
    <BandTag tone="warn">Reconnecting</BandTag>
  ) : onCall ? (
    <BandTag tone="ok">{state.phase === 'starting' ? 'Starting' : 'On a call'}</BandTag>
  ) : state.phase === 'ended' ? (
    <BandTag tone="plain">Call ended</BandTag>
  ) : (
    <BandTag tone="plain">Ready</BandTag>
  );

  return (
    <CueRoot direction={settings?.direction ?? 'honey'} theme={settings?.theme ?? 'system'} density="comfortable" className="sp-root cue-dash">
      <AppBar
        className="sp-band"
        tabs={tabs}
        active={tab}
        end={status}
        onNavigate={(t, e) => {
          e.preventDefault();
          go(t.id as Tab);
        }}
      />
      {!settings || !session.connected ? (
        <main className="sp-main" aria-busy="true">
          <div className="sp-loading">
            <Skeleton height={52} />
            <Skeleton lines={4} />
          </div>
        </main>
      ) : tab === 'settings' ? (
        <main className="sp-main">
          <SettingsScreen settings={settings} update={update} />
        </main>
      ) : tab === 'dispositions' ? (
        <main className="sp-main">
          <DispositionsScreen onOpenSettings={() => go('settings')} />
        </main>
      ) : (
        <Live session={session} settings={settings} onOpenSettings={() => go('settings')} />
      )}
    </CueRoot>
  );
}
