import { cx } from '../lib/cx';
import type { Connection } from '../lib/core';
import { Icon } from '../primitives/Icon';

const TEXT: Record<Connection, string> = { live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline' };

/** Connection to the Cue server. Text always; the dot and icon only support it. */
export function ConnectionPill({ connection, compact, className }: { connection: Connection; compact?: boolean; className?: string }) {
  return (
    <span className={cx('cue-conn', `cue-conn--${connection}`, compact && 'is-compact', className)} role="status">
      {connection === 'live' && <span className="cue-conn__dot" aria-hidden />}
      {connection === 'reconnecting' && <span className="cue-spinner cue-spinner--xs" aria-hidden />}
      {connection === 'offline' && <Icon name="wifi-off" size={13} />}
      <span className="cue-conn__text">{TEXT[connection]}</span>
    </span>
  );
}
