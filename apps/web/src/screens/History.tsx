import { OUTCOME_LABEL, formatDuration, type CallSummary } from '@cue/core';
import { Chip, EmptyState, ErrorState, Icon, Skeleton, Sprout } from '@cue/ui';
import { useResource } from '../hooks/useResource';
import { hrefFor } from '../router';
import { getApi } from '../state/api';

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function status(c: CallSummary): { label: string; tone: 'ok' | 'neutral' | 'accent' | 'warn' } {
  if (c.status === 'live') return { label: 'Live', tone: 'warn' };
  if (c.outcome === 'meeting_booked') return { label: OUTCOME_LABEL.meeting_booked, tone: 'ok' };
  if (c.outcome) return { label: OUTCOME_LABEL[c.outcome as keyof typeof OUTCOME_LABEL] ?? c.outcome, tone: 'neutral' };
  return { label: c.status === 'reviewing' ? 'Reviewing' : 'Ended', tone: 'accent' };
}

/** Past calls, newest first. */
export function History() {
  const res = useResource((signal) => getApi().listCalls(100, { signal }), [], 10_000);
  const calls = res.data;
  return (
    <div className="web-screen web-page">
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">History</p>
          <h1 className="web-h1">Past calls</h1>
          <p className="web-muted">Open one to debrief it, or to read what Cue learned.</p>
        </div>
      </header>
      {res.error && !calls ? (
        <ErrorState title="Can't load calls" message={res.error.message} onRetry={res.reload} />
      ) : !calls ? (
        <div className="web-panel web-stack" aria-busy="true">
          <Skeleton lines={6} height={20} />
        </div>
      ) : calls.length === 0 ? (
        <EmptyState art={<Sprout state="idle" size={84} />} title="No calls yet">
          Start a call or run the demo from Live, and it will show up here.
        </EmptyState>
      ) : (
        <ul className="web-calls">
          {calls.map((c) => {
            const st = status(c);
            return (
              <li key={c.id}>
                <a className="web-call" href={c.status === 'live' ? hrefFor({ name: 'live' }) : hrefFor({ name: 'debrief', id: c.id })}>
                  <span className="web-call__main">
                    <span className="web-call__name web-trunc">{c.prospect.name || c.prospect.company || 'Unnamed prospect'}</span>
                    <span className="web-call__sub web-trunc">{[c.prospect.title, c.prospect.company].filter(Boolean).join(' · ') || c.source}</span>
                  </span>
                  <span className="web-call__meta">
                    <Chip size="sm" tone={st.tone}>
                      {st.label}
                    </Chip>
                    <span className="web-call__stats web-small web-muted">
                      {c.used}/{c.suggestions} used{c.durationMs !== null ? ` · ${formatDuration(c.durationMs)}` : ''}
                    </span>
                    <time className="web-small web-muted" dateTime={new Date(c.startedAt).toISOString()}>
                      {DATE.format(c.startedAt)}
                    </time>
                  </span>
                  <Icon name="chevron" size={16} className="web-call__chev" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
