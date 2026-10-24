import { MOMENT_META, OUTCOME_LABEL, type CallReview, type CallView, type FeedbackRequest } from '@cue/core';
import { Button, Chip, DebriefForm, EmptyState, ErrorState, Icon, Meter, MomentChip, Skeleton, Sprout } from '@cue/ui';
import { useEffect } from 'react';
import { navigate } from '../router';
import { getApi } from '../state/api';
import { attachCall, callStore, detachCall } from '../state/call';
import { useStore } from '../state/store';

/** After the call: the debrief form, then Cue's review once `review.completed` arrives. */
export function Debrief({ id }: { id: string }) {
  const { callId, view, connection } = useStore(callStore);
  useEffect(() => {
    if (callId !== id) attachCall(id);
  }, [id, callId]);

  const mine = callId === id ? view : null;

  if (!mine) {
    return (
      <div className="web-screen web-page">
        {connection === 'offline' ? (
          <ErrorState title="Can't reach the server" message="The debrief loads when Cue is back online." onRetry={() => attachCall(id)} />
        ) : (
          <div className="web-panel web-stack" aria-busy="true">
            <Skeleton width="40%" height={24} />
            <Skeleton lines={3} />
          </div>
        )}
      </div>
    );
  }

  const submit = async (f: FeedbackRequest) => {
    await getApi().feedback(id, f);
  };

  return (
    <div className="web-screen web-page web-debrief">
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">Debrief</p>
          <h1 className="web-h1 web-trunc">{mine.prospect.name || mine.prospect.company || 'Call'}</h1>
          <p className="web-muted">
            {[mine.prospect.title, mine.prospect.company].filter(Boolean).join(' · ')}
            {mine.outcome && ` · ${OUTCOME_LABEL[mine.outcome.outcome]}`}
          </p>
        </div>
      </header>

      {mine.status === 'live' ? (
        <EmptyState art={<Sprout state="listening" size={72} />} title="This call is still on" action={<Button onClick={() => navigate({ name: 'live' })}>Back to the call</Button>}>
          The debrief opens when the call ends.
        </EmptyState>
      ) : !mine.feedback ? (
        <div className="web-panel web-debrief__form">
          <DebriefForm view={mine} onSubmit={submit} onSkip={() => navigate({ name: 'history' })} />
        </div>
      ) : (
        <Review view={mine} />
      )}
    </div>
  );
}

function Review({ view }: { view: CallView }) {
  const r: CallReview | null = view.review;
  const booked = (view.outcome?.outcome ?? view.feedback?.outcome) === 'meeting_booked';
  if (!r) {
    return (
      <section className="web-panel web-review web-review--pending" aria-busy="true" aria-live="polite">
        <Sprout state="learning" size={96} />
        <div>
          <h2 className="web-h2">Cue is learning from this call</h2>
          <p className="web-muted">Reviewing what you said against what booked. The playbook updates when it's done.</p>
          <Skeleton lines={3} />
        </div>
      </section>
    );
  }
  const used = r.linesUsed.filter((l) => l.used);
  const byId = new Map(view.history.map((h) => [h.suggestion.id, h.suggestion]));
  return (
    <div className="web-review">
      <section className={`web-panel web-review__hero${booked ? ' is-booked' : ''}`} aria-live="polite">
        <Sprout state={booked ? 'celebrating' : 'learning'} size={88} />
        <div className="web-review__hero-text">
          <p className="web-eyebrow">{booked ? 'Meeting booked' : OUTCOME_LABEL[r.outcome]}</p>
          <h2 className="web-h2">{r.summary}</h2>
          <div className="web-review__impact">
            <Meter value={r.suggestionImpact} label="How much Cue helped" valueText={`${Math.round(r.suggestionImpact * 100)}%`} showLabel tone="ok" />
          </div>
        </div>
      </section>

      <div className="web-grid-2 web-review__grid">
        <ReviewList title="What worked" icon="check" items={r.whatWorked} tone="ok" />
        <ReviewList title="What didn't" icon="alert" items={r.whatDidnt} tone="warn" />
        <ReviewList title="Coaching" icon="spark" items={r.coaching} tone="info" />
        <section className="web-panel">
          <div className="web-panel__head">
            <h3 className="web-h3">Lines credited</h3>
            <Chip size="sm" tone="ok">
              {used.length} used
            </Chip>
          </div>
          {used.length === 0 ? (
            <p className="web-muted">No suggested line was said this call.</p>
          ) : (
            <ul className="web-credits">
              {used.map((l) => {
                const s = byId.get(l.suggestionId);
                return (
                  <li key={l.suggestionId} className={`web-credit cue-fam-${s ? MOMENT_META[s.situation.moment].family : 'neutral'}`}>
                    {s && <MomentChip moment={s.situation.moment} size="sm" />}
                    <p className="web-credit__line">{l.saidText ?? s?.say ?? ''}</p>
                    {l.stepWin && (
                      <Chip size="sm" tone="ok" icon="check">
                        Step won
                      </Chip>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {r.candidateLines.length > 0 && (
        <section className="web-panel">
          <div className="web-panel__head">
            <h3 className="web-h3">New lines for the playbook</h3>
            <Chip size="sm" tone="accent">
              {r.candidateLines.length} candidate{r.candidateLines.length === 1 ? '' : 's'}
            </Chip>
          </div>
          <ul className="web-credits">
            {r.candidateLines.map((c, i) => (
              <li key={i} className={`web-credit cue-fam-${MOMENT_META[c.moment].family}`}>
                <MomentChip moment={c.moment} size="sm" />
                <p className="web-credit__line">{c.text}</p>
                <p className="web-muted web-small">{c.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="web-row web-row--end">
        <Button
          variant="ghost"
          icon="plus"
          onClick={() => {
            detachCall();
            navigate({ name: 'live' });
          }}
        >
          New call
        </Button>
        <Button variant="primary" iconEnd="arrow-right" onClick={() => navigate({ name: 'playbook' })}>
          See the playbook
        </Button>
      </div>
    </div>
  );
}

function ReviewList({ title, icon, items, tone }: { title: string; icon: 'check' | 'alert' | 'spark'; items: string[]; tone: 'ok' | 'warn' | 'info' }) {
  return (
    <section className="web-panel">
      <div className="web-panel__head">
        <h3 className="web-h3">
          <span className={`web-dot-icon is-${tone}`}>
            <Icon name={icon} size={14} />
          </span>
          {title}
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="web-muted">Nothing noted.</p>
      ) : (
        <ul className="web-bullets">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
