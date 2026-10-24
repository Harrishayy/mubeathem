import { CueRoot, ToastRegion } from '@cue/ui';
import { useEffect } from 'react';
import { bindSpaceToTalk } from './capture/speaker';
import { useMedia, DESKTOP_QUERY } from './hooks/useMedia';
import { navigate, useRoute } from './router';
import { DebriefModal } from './screens/Debrief';
import { History } from './screens/History';
import { Contacts } from './screens/Contacts';
import { Team } from './screens/Team';
import { Insights } from './screens/Insights';
import { Live } from './screens/Live';
import { ModelScreen } from './screens/Model';
import { PipRoute } from './screens/PipRoute';
import { Playbook } from './screens/Playbook';
import { SettingsScreen } from './screens/Settings';
import { TopBar } from './shell/Nav';
import { GlobalOverbar } from './shell/GlobalOverbar';
import { settingsStore } from './state/settings';
import { useStore } from './state/store';
import { dismissToast, openDebrief, uiStore } from './state/ui';

const TITLES: Record<string, string> = {
  live: 'Live',
  contacts: 'Contacts',
  team: 'Team',
  playbook: 'Playbook',
  model: 'Model',
  history: 'History',
  insights: 'Insights',
  settings: 'Settings',
  debrief: 'Debrief',
  pip: 'Pop-out',
};

/** Screens laid out as fixed-height dashboards on laptops (panes scroll inside themselves). */
const FIT = new Set(['live', 'contacts', 'history']);

export function App() {
  const route = useRoute();
  const s = useStore(settingsStore);
  const toasts = useStore(uiStore, (u) => u.toasts);
  const desktop = useMedia(DESKTOP_QUERY);

  useEffect(() => bindSpaceToTalk(window), []);
  // Old links (#/debrief/<id>) open the debrief as a modal over History.
  useEffect(() => {
    if (route.name !== 'debrief') return;
    openDebrief(route.id);
    navigate({ name: 'history' });
  }, [route]);
  useEffect(() => {
    document.title = route.name === 'live' ? 'Cue' : `${TITLES[route.name]} · Cue`;
  }, [route.name]);

  if (route.name === 'pip') {
    return <PipRoute id={route.id} />;
  }

  return (
    <CueRoot direction={s.direction} theme={s.theme} density={s.density} className="web-root">
      <div className={`web-app cue-dash${desktop ? ' is-desktop' : ' is-mobile'}${FIT.has(route.name) ? ' cue-dash--fit' : ''}`} data-route={route.name}>
        <TopBar route={route} />
        <main className="web-main cue-dash__main" id="main">
          {route.name === 'live' && <Live />}
          {route.name === 'contacts' && <Contacts />}
          {route.name === 'team' && <Team />}
          {route.name === 'playbook' && <Playbook />}
          {route.name === 'model' && <ModelScreen />}
          {route.name === 'history' && <History />}
          {route.name === 'insights' && <Insights />}
          {route.name === 'settings' && <SettingsScreen />}
          {route.name === 'debrief' && <History />}
        </main>
        <GlobalOverbar route={route} desktop={desktop} />
        <DebriefModal />
      </div>
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </CueRoot>
  );
}
