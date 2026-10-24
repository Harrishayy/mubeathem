import type { FeedbackRequest } from '@cue/core';
import { Button, DebriefForm, EmptyState, Sprout } from '@cue/ui';
import { request, type SessionState } from '../../src/messages';

/** After the call: the debrief, then what the review found once `review.completed` arrives. */
export function Debrief({ state }: { state: SessionState }) {
  const view = state.view!;
  const booked = (view.feedback?.outcome ?? view.outcome?.outcome) === 'meeting_booked';

  const submit = async (f: FeedbackRequest) => {
    const res = await request({ type: 'session.feedback', feedback: f });
    if (!res.ok) throw new Error(res.error);
  };
  const next = () => void request({ type: 'session.reset' });

  if (!view.feedback) {
    return (
      <div className="sp-debrief">
        {state.error && (
          <p className="sp-banner" role="alert">
            {state.error}
          </p>
        )}
        <DebriefForm view={view} onSubmit={submit} onSkip={next} />
      </div>
    );
  }

  const r = view.review;
  return (
    <div className="sp-debrief">
      <EmptyState
        art={<Sprout state={booked ? 'celebrating' : r ? 'learning' : 'thinking'} size={88} growth={r ? 1 : 0.4} />}
        title={booked ? 'Booked. Nice work.' : 'Debrief saved'}
        action={
          <Button variant="primary" icon="phone" onClick={next}>
            Next call
          </Button>
        }
      >
        {r ? r.summary : 'Cue is reviewing the call. What it learns goes into the team playbook.'}
      </EmptyState>
      {r && (r.coaching.length > 0 || r.whatWorked.length > 0) && (
        <section className="sp-section sp-review" aria-label="Review">
          {r.whatWorked.length > 0 && (
            <>
              <h2 className="sp-label">What worked</h2>
              <ul className="sp-list">
                {r.whatWorked.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          {r.coaching.length > 0 && (
            <>
              <h2 className="sp-label">Try next time</h2>
              <ul className="sp-list">
                {r.coaching.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
