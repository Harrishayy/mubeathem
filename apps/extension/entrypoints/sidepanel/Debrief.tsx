import { OUTCOME_LABEL, type FeedbackRequest } from '@cue/core';
import { ActionBar, Button, DebriefForm, Dialog, Meter, PaneSection, Skeleton, Sprout } from '@cue/ui';
import { request, type SessionState } from '../../src/messages';

/**
 * After the call: the debrief as a dialog over the ended call (the same pattern as the web app, never a
 * new tab or window). Form first, then what Cue's review found once `review.completed` arrives.
 * Escape, Close or Skip put the rep back on the ended call; "Next call" clears it.
 */
export function DebriefDialog({ state, open, onClose }: { state: SessionState; open: boolean; onClose: () => void }) {
  const view = state.view!;
  const who = view.prospect.name || view.prospect.company || 'Call';
  const meta = [who, view.prospect.title, view.prospect.company, view.outcome && OUTCOME_LABEL[view.outcome.outcome]].filter(Boolean).join(' · ');
  const title = view.feedback ? (view.review ? 'What Cue learned' : 'Debrief saved') : 'How did it go?';

  const submit = async (f: FeedbackRequest) => {
    const res = await request({ type: 'session.feedback', feedback: f });
    if (!res.ok) throw new Error(res.error);
  };

  return (
    <Dialog open={open} onClose={onClose} eyebrow="Debrief" title={title} description={meta} className="sp-debrief">
      {state.error && (
        <p className="sp-banner" role="alert">
          {state.error}
        </p>
      )}
      {!view.feedback ? <DebriefForm view={view} onSubmit={submit} onSkip={onClose} heading={false} /> : <Review state={state} onClose={onClose} />}
    </Dialog>
  );
}

function Review({ state, onClose }: { state: SessionState; onClose: () => void }) {
  const view = state.view!;
  const r = view.review;
  const booked = (view.feedback?.outcome ?? view.outcome?.outcome) === 'meeting_booked';
  return (
    <div className="sp-review" aria-live="polite">
      <div className="sp-review__hero">
        <Sprout state={booked ? 'celebrating' : r ? 'learning' : 'thinking'} size={72} growth={r ? 1 : 0.4} />
        <div className="sp-stack">
          <h3 className="sp-review__title">{booked ? 'Booked. Nice work.' : r ? OUTCOME_LABEL[r.outcome] : 'Thanks, saved.'}</h3>
          {r ? <p>{r.summary}</p> : <p className="sp-hint">Cue is reviewing the call. What it learns makes your next suggestions better.</p>}
          {!r && <Skeleton lines={2} />}
          {r && <Meter value={r.suggestionImpact} label="How much Cue helped" valueText={`${Math.round(r.suggestionImpact * 100)}%`} showLabel tone="ok" />}
        </div>
      </div>
      {r && r.whatWorked.length > 0 && (
        <PaneSection label="What worked">
          <ul className="sp-list">
            {r.whatWorked.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </PaneSection>
      )}
      {r && r.coaching.length > 0 && (
        <PaneSection label="Try next time">
          <ul className="sp-list">
            {r.coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </PaneSection>
      )}
      <ActionBar end={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        <Button variant="primary" icon="phone" onClick={() => void request({ type: 'session.reset' })}>
          Next call
        </Button>
      </ActionBar>
    </div>
  );
}
