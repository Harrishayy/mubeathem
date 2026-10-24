import { ADAPTER_THRESHOLD_DEFAULT } from './constants';
import { AppBar, BandTag, Button, CallTimer, type AppTab } from '@cue/ui';
import { useResource } from '../hooks/useResource';
import { hrefFor, type Route, type SimpleRoute } from '../router';
import { getApi } from '../state/api';
import { callStore } from '../state/call';
import { useStore } from '../state/store';
import { endAndDebrief } from './useOverbar';

type Section = SimpleRoute;

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'history', label: 'History' },
  { id: 'team', label: 'Team' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'model', label: 'Model' },
  { id: 'insights', label: 'Insights' },
  { id: 'settings', label: 'Settings' },
];

function activeSection(route: Route): Section {
  if (route.name === 'debrief') return 'history';
  if (route.name === 'pip') return 'live';
  return route.name;
}

/**
 * The deep-olive band on every screen: wordmark, section tabs (Live carries a dot during a call,
 * Playbook and Model carry their counts), and on the right the Mubit status or the call tally with
 * End call.
 */
export function TopBar({ route }: { route: Route }) {
  const { view } = useStore(callStore);
  const live = view?.status === 'live';
  const stats = useResource((signal) => getApi().stats({ signal }), [], 30_000);
  const playbook = useResource((signal) => getApi().playbook({ signal }), [], 60_000);
  const tasks = stats.data?.tasks ?? [];
  const trained = tasks.filter((t) => t.ok >= (t.adapterThreshold || ADAPTER_THRESHOLD_DEFAULT)).length;
  const lines = playbook.data?.lines.filter((l) => l.status === 'active').length;

  const tabs: AppTab[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    href: hrefFor({ name: s.id } as Route),
    live: s.id === 'live' && live,
    count: s.id === 'playbook' && lines !== undefined ? lines : s.id === 'model' && tasks.length > 0 ? `${trained}/${tasks.length}` : undefined,
  }));

  const end = live ? (
    <>
      <span className="cue-tallybox" role="status">
        <span className="cue-tallybox__dot" aria-hidden />
        <span className="cue-label" style={{ color: 'var(--bad)' }}>
          Live
        </span>
        <CallTimer startedAt={view.startedAt} endedAt={view.endedAt} />
      </span>
      <Button size="sm" variant="secondary" icon="phone-off" onClick={() => void endAndDebrief()}>
        End call
      </Button>
    </>
  ) : stats.error ? (
    <BandTag tone="warn">Server offline</BandTag>
  ) : tasks.length > 0 ? (
    <BandTag tone={trained === tasks.length ? 'ok' : 'plain'}>{`Mubit · ${trained}/${tasks.length} trained`}</BandTag>
  ) : null;

  return <AppBar tabs={tabs} active={activeSection(route)} end={end} />;
}
