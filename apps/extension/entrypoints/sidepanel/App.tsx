import { CueRoot, SegmentedControl, Skeleton, Sprout } from '@cue/ui';
import { mascotFor } from '@cue/core';
import { useEffect, useState } from 'react';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';
import { Debrief } from './Debrief';
import { Live } from './Live';
import { SettingsScreen } from './Settings';

type Tab = 'call' | 'settings';

/** The side panel: the expanded overbar as a column, the debrief after the call, and settings. */
export function App() {
  const session = useSession();
  const [settings, update] = useSettings();
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#settings' ? 'settings' : 'call'));

  useEffect(() => {
    const onHash = () => setTab(location.hash === '#settings' ? 'settings' : 'call');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { state } = session;
  const ended = state.phase === 'ended' && state.view;

  return (
    <CueRoot direction={settings?.direction ?? 'honey'} theme={settings?.theme ?? 'system'} density="comfortable" className="sp-root">
      <header className="sp-header">
        <span className="sp-brand">
          <Sprout state={mascotFor(state.view, state.connection)} size={26} voiceLevel={session.levels.prospect} />
          <span className="sp-brand__name">Cue</span>
        </span>
        <SegmentedControl<Tab>
          label="Section"
          size="sm"
          value={tab}
          onChange={(v) => {
            setTab(v);
            history.replaceState(null, '', v === 'settings' ? '#settings' : '#');
          }}
          options={[
            { value: 'call', label: ended ? 'Debrief' : 'Call' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
      </header>
      <main className="sp-main">
        {!settings || !session.connected ? (
          <div className="sp-loading" aria-busy="true">
            <Skeleton height={52} radius={26} />
            <Skeleton lines={4} />
          </div>
        ) : tab === 'settings' ? (
          <SettingsScreen settings={settings} update={update} />
        ) : ended ? (
          <Debrief state={state} />
        ) : (
          <Live session={session} settings={settings} onOpenSettings={() => setTab('settings')} />
        )}
      </main>
    </CueRoot>
  );
}
