import { Overbar } from '@cue/ui';
import { useMedia, PHONE_QUERY } from '../hooks/useMedia';
import type { Route } from '../router';
import { useStore } from '../state/store';
import { uiStore } from '../state/ui';
import { useOverbar } from './useOverbar';

/**
 * The overbar floats over the other screens while a call is on (Cluely-style): pinned under the band
 * on laptops, a bottom sheet on phones. Live shows the cue in its own pane.
 */
export function GlobalOverbar({ route, desktop }: { route: Route; desktop: boolean }) {
  const props = useOverbar();
  const pip = useStore(uiStore, (u) => u.pip);
  const phone = useMedia(PHONE_QUERY);
  const live = props.view?.status === 'live';
  // The Live dashboard shows the cue itself; elsewhere the bar floats over the screen during a call.
  const show = !pip && live && route.name !== 'live' && route.name !== 'debrief';
  if (!show) return null;
  return (
    <div className={`web-overbar${desktop ? '' : ' is-mobile'}`} data-placement={phone ? 'sheet' : 'top'}>
      <Overbar {...props} placement={phone ? 'sheet' : 'top'} />
    </div>
  );
}
