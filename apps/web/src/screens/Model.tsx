import { Chip, ErrorState, ModelGrowthPanel, Skeleton } from '@cue/ui';
import { useResource } from '../hooks/useResource';
import { getApi } from '../state/api';

/** "Your model is growing": per-task Mubit telemetry against the 25-example adapter threshold. */
export function ModelScreen() {
  const stats = useResource((signal) => getApi().stats({ signal }), [], 3_000);
  const health = useResource((signal) => getApi().health({ signal }), [], 15_000);
  const h = health.data;
  return (
    <div className="web-screen web-page">
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">Model</p>
          <h1 className="web-h1">Every call trains it</h1>
          <p className="web-muted">Every call goes through Mubit as one session. Each task trains its own adapter once it has 25 kept examples.</p>
        </div>
        {health.error && !h && (
          <Chip tone="bad" icon="wifi-off">
            Server unreachable
          </Chip>
        )}
        {h && (
          <div className="web-row web-row--wrap">
            <Chip tone={h.mubit.configured ? (h.mubit.reachable === false ? 'bad' : 'ok') : 'warn'} icon={h.mubit.configured ? 'sprout' : 'alert'}>
              {!h.mubit.configured ? 'Rules engine only' : h.mubit.reachable === false ? 'Mubit unreachable' : h.mubit.reachable === null ? 'Mubit configured' : 'Mubit on'}
            </Chip>
            <Chip tone="neutral">
              <span className="web-mono">{h.mubit.models.fast}</span> · <span className="web-mono">{h.mubit.models.write}</span>
            </Chip>
          </div>
        )}
      </header>
      {h && !h.mubit.configured && (stats.data?.tasks.some((t) => t.calls > 0) ?? false) && (
        <p className="web-note" role="note">
          This server has no Mubit key, so new calls run on the rules engine. The counts below are from calls it sent to Mubit before.
        </p>
      )}
      {stats.error && !stats.data ? (
        <ErrorState title="Can't load model stats" message={stats.error.message} onRetry={stats.reload} />
      ) : !stats.data ? (
        <div className="web-panel web-stack" aria-busy="true">
          <Skeleton lines={5} />
        </div>
      ) : (
        <ModelGrowthPanel stats={stats.data} live={!stats.error} />
      )}
    </div>
  );
}
