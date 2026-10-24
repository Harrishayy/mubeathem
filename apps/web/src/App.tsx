import { CueRoot, ToastRegion } from '@cue/ui';
import { useEffect } from 'react';
import { bindSpaceToTalk } from './capture/speaker';
import { DemoHud } from './demo/DemoHud';
import { useMedia, DESKTOP_QUERY } from './hooks/useMedia';
import { useRoute } from './router';
import { Debrief } from './screens/Debrief';
import { History } from './screens/History';
import { Live } from './screens/Live';
import { ModelScreen } from './screens/Model';
import { PipRoute } from './screens/PipRoute';
import { Playbook } from './screens/Playbook';
import { Practice } from './screens/Practice';
import { SettingsScreen } from './screens/Settings';
import { Rail, TabBar } from './shell/Nav';
import { GlobalOverbar } from './shell/GlobalOverbar';
import { settingsStore } from './state/settings';
import { useStore } from './state/store';
import { dismissToast, uiStore } from './state/ui';

const TITLES: Record<string, string> = {
  live: 'Live',
  practice: 'Practice',
  playbook: 'Playbook',
  model: 'Model',
  history: 'History',
  settings: 'Settings',
  debrief: 'Debrief',
  pip: 'Pop-out',
};

export function App() {
  const route = useRoute();
  const s = useStore(settingsStore);
  const toasts = useStore(uiStore, (u) => u.toasts);
  const desktop = useMedia(DESKTOP_QUERY);

  useEffect(() => bindSpaceToTalk(window), []);
  useEffect(() => {
    document.title = route.name === 'live' ? 'Cue' : `${TITLES[route.name]} · Cue`;
  }, [route.name]);

  if (route.name === 'pip') {
    return <PipRoute id={route.id} />;
  }

  return (
    <CueRoot direction={s.direction} theme={s.theme} density={s.density} className="web-root">
      <div className={`web-app${desktop ? ' is-desktop' : ' is-mobile'}`} data-route={route.name}>
        {desktop && <Rail route={route} />}
        <main className="web-main" id="main">
          {route.name === 'live' && <Live />}
          {route.name === 'practice' && <Practice />}
          {route.name === 'playbook' && <Playbook />}
          {route.name === 'model' && <ModelScreen />}
          {route.name === 'history' && <History />}
          {route.name === 'settings' && <SettingsScreen />}
          {route.name === 'debrief' && <Debrief id={route.id} />}
        </main>
        {!desktop && <TabBar route={route} />}
        <GlobalOverbar route={route} desktop={desktop} />
        <DemoHud />
      </div>
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </CueRoot>
  );
}
