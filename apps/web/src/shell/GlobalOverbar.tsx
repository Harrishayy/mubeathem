import { Overbar } from '@cue/ui';
import { DemoAccessory, demoStoreActive } from '../demo/DemoHud';
import { useMedia, PHONE_QUERY } from '../hooks/useMedia';
import type { Route } from '../router';
import { useStore } from '../state/store';
import { uiStore } from '../state/ui';
import { useOverbar } from './useOverbar';

/**
 * The overbar floats over every screen while a call is on (Cluely-style): pinned top-centre on
 * laptops, a bottom sheet on phones. Practice renders its own inline copy; the debrief has none.
 */
export function GlobalOverbar({ route, desktop }: { route: Route; desktop: boolean }) {
  const props = useOverbar();
  const pip = useStore(uiStore, (u) => u.pip);
  const phone = useMedia(PHONE_QUERY);
  const live = props.view?.status === 'live';
  const demo = useStore(demoStoreActive);
  const show = !pip && route.name !== 'debrief' && route.name !== 'practice' && (route.name === 'live' || live);
  if (!show) return null;
  return (
    <div className={`web-overbar${desktop ? '' : ' is-mobile'}`} data-placement={phone ? 'sheet' : 'top'}>
      <Overbar {...props} placement={phone ? 'sheet' : 'top'} accessory={demo ? <DemoAccessory /> : undefined} />
    </div>
  );
}
