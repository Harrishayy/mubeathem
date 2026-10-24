import { MOMENT_META, OUTCOME_LABEL, type CallReview, type CallView, type FeedbackRequest } from '@cue/core';
import { ActionBar, Bar, Button, Chip, DebriefForm, Dialog, EmptyState, ErrorState, MomentChip, PaneSection, Skeleton, Sprout, StatGrid } from '@cue/ui';
import { useEffect } from 'react';
import { navigate } from '../router';
import { getApi } from '../state/api';
import { attachCall, callStore, detachCall } from '../state/call';
import { useStore } from '../state/store';
import { closeDebrief, uiStore } from '../state/ui';

/**
 * After the call: the debrief opens as a modal over whatever screen the rep is on (the call console,
 * contacts, history), never a page change. Form first, then Cue's review once `review.completed`
 * arrives. Escape, the close button or a backdrop click put the rep back where they were.
 */
export function DebriefModal() {
  const id = useStore(uiStore, (u) => u.debrief);
  const { callId, view } = useStore(callStore);
  const mine = id && callId === id ? view : null;
  const who = mine ? mine.prospect.name || mine.prospect.company || 'Call' : 'Call';
  const meta = mine ? [who, mine.prospect.title, mine.prospect.company, mine.outcome && OUTCOME_LABEL[mine.outcome.outcome]].filter(Boolean).join(' · ') : undefined;
  const title = mine?.feedback ? (mine.review ? 'What Cue learned' : 'Cue is learning') : 'How did it go?';
  return (
    <Dialog open={id !== null} onClose={closeDebrief} eyebrow="Debrief" title={title} description={meta || undefined} size="lg" className="web-debrief-modal">
      {id && <DebriefBody id={id} />}
    </Dialog>
  );
}

function DebriefBody({ id }: { id: string }) {
  const { callId, view, connection } = useStore(callStore);
  useEffect(() => {
    if (callId !== id) attachCall(id);
  }, [id, callId]);

  const mine = callId === id ? view : null;

  if (!mine) {
    return connection === 'offline' ? (
      <ErrorState title="Can't reach the server" message="The debrief loads when Cue is back online." onRetry={() => attachCall(id)} />
    ) : (
      <div className="web-stack" aria-busy="true">
        <Skeleton width="40%" height={24} />
        <Skeleton lines={3} />
      </div>
    );
  }

  const submit = async (f: FeedbackRequest) => {
    await getApi().feedback(id, f);
  };

  if (mine.status === 'live') {
    return (
      <EmptyState art={<Sprout state="listening" size={72} />} title="This call is still on" action={<Button onClick={closeDebrief}>Back to the call</Button>}>
        The debrief opens when the call ends.
      </EmptyState>
    );
  }
  return !mine.feedback ? <DebriefForm view={mine} onSubmit={submit} onSkip={closeDebrief} heading={false} /> : <Review view={mine} />;
}

function Review({ view }: { view: CallView }) {
  const r: CallReview | null = view.review;
  const booked = (view.outcome?.outcome ?? view.feedback?.outcome) === 'meeting_booked';
  if (!r) {
    return (
      <section className="web-review web-review--pending" aria-busy="true" aria-live="polite">
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
  const wins = r.linesUsed.filter((l) => l.stepWin).length;
  const byId = new Map(view.history.map((h) => [h.suggestion.id, h.suggestion]));
  return (
    <div className="web-review">
      <section className={`web-review__hero${booked ? ' is-booked' : ''}`} aria-live="polite">
        <Sprout state={booked ? 'celebrating' : 'learning'} size={72} />
        <div className="web-review__hero-text">
          <p className="cue-label">{booked ? 'Meeting booked' : OUTCOME_LABEL[r.outcome]}</p>
          <h2 className="web-review__summary">{r.summary}</h2>
        </div>
      </section>

      <StatGrid
        columns={5}
        items={[
          { label: 'Outcome', value: <span className="web-review__stat-word">{OUTCOME_LABEL[r.outcome]}</span> },
          { label: 'Cue helped', value: `${Math.round(r.suggestionImpact * 100)}%`, note: <><Bar value={r.suggestionImpact} tone="ok" /> How much the suggestions helped, by Cue's review</> },
          { label: 'Lines used', value: `${used.length}/${view.history.length}`, note: 'Suggestions you said, of those shown' },
          { label: 'Moved forward', value: wins, note: 'Lines that got the call to its next step' },
          { label: 'Their attitude', value: <span className="web-review__stat-word">{ATTITUDE_LABEL[r.customerAttitude] ?? r.customerAttitude}</span> },
        ]}
      />

      <div className="web-review__grid">
        <ReviewList title="What worked" items={r.whatWorked} tone="ok" />
        <ReviewList title="What didn't" items={r.whatDidnt} tone="warn" />
        <ReviewList title="Coaching" items={r.coaching} tone="info" />
        <PaneSection label="Lines credited" meta={`${used.length} used`} hint="Suggestions you said on this call. These earn credit in the playbook.">
          {used.length === 0 ? (
            <p className="web-muted web-small">No suggested line was said this call.</p>
          ) : (
            <ul className="web-credits">
              {used.map((l) => {
                const s = byId.get(l.suggestionId);
                return (
                  <li key={l.suggestionId} className={`web-credit cue-fam-${s ? MOMENT_META[s.situation.moment].family : 'neutral'}`}>
                    <span className="web-credit__head">
                      {s && <MomentChip moment={s.situation.moment} size="sm" />}
                      {l.stepWin && (
                        <Chip size="sm" tone="ok" icon="check">
                          Moved the call forward
                        </Chip>
                      )}
                    </span>
                    <p className="web-credit__line">{l.saidText ?? s?.say ?? ''}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </PaneSection>
      </div>

      {r.candidateLines.length > 0 && (
        <PaneSection label="New lines for the playbook" meta={`${r.candidateLines.length} candidate${r.candidateLines.length === 1 ? '' : 's'}`} hint="Lines from this call worth trying again. They wait in the Playbook for a manager to approve.">
          <ul className="web-credits">
            {r.candidateLines.map((c, i) => (
              <li key={i} className={`web-credit cue-fam-${MOMENT_META[c.moment].family}`}>
                <MomentChip moment={c.moment} size="sm" />
                <p className="web-credit__line">{c.text}</p>
                <p className="web-muted web-small">{c.rationale}</p>
              </li>
            ))}
          </ul>
        </PaneSection>
      )}

      <ActionBar
        className="web-review__actions"
        end={
          <>
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => {
                closeDebrief();
                detachCall();
                navigate({ name: 'live' });
              }}
            >
              New call
            </Button>
            <Button variant="primary" iconEnd="arrow-right" onClick={() => (closeDebrief(), navigate({ name: 'playbook' }))}>
              See the playbook
            </Button>
          </>
        }
      />
    </div>
  );
}

const ATTITUDE_LABEL: Record<string, string> = { friendly: 'Friendly', curious: 'Curious', neutral: 'Neutral', guarded: 'Guarded', irritated: 'Irritated', hostile: 'Hostile' };

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone: 'ok' | 'warn' | 'info' }) {
  return (
    <PaneSection label={title} meta={items.length ? String(items.length) : undefined} className={`web-review__list is-${tone}`}>
      {items.length === 0 ? (
        <p className="web-muted web-small">Nothing noted.</p>
      ) : (
        <ul className="web-bullets web-small">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </PaneSection>
  );
}
