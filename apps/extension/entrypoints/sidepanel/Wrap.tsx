import { OUTCOME_LABEL, RECEPTIVITY_LABEL, receptivityFromScore, formatDuration, type CallView, type Outcome } from '@cue/core';
import { Button, Icon, OutcomeBar, Skeleton } from '@cue/ui';
import { useState } from 'react';
import { request, type SessionState } from '../../src/messages';
import { webAppRoute, type Settings } from '../../src/settings';
import { momentStrip, moodArc, prospectKey, talkShare } from '../../src/ui/companion';
import { role } from '../../src/ui/format';
import { Section, Who } from './parts';

const SOURCE_WORDS: Record<string, string> = { trellus: 'from Trellus', hubspot: 'from HubSpot', rep: 'you marked it', review: "from Cue's review" };

/**
 * After the call: the outcome (Trellus logs it; one tap to confirm or correct, which is what teaches
 * Cue), the call at a glance, the review once it's written, the lines that landed, and who's next.
 * The full debrief lives in the Cue app.
 */
export function Wrap({ state, settings }: { state: SessionState; settings: Settings }) {
  const view = state.view;
  if (!view)
    return (
      <main className="sp-main">
        <Skeleton lines={4} />
      </main>
    );
  const next = state.page?.prospect && prospectKey(state.page.prospect) !== prospectKey(view.prospect) ? state.page.prospect : null;
  const landed = view.history.filter((h) => h.action === 'used' || h.action === 'edited');
  const strip = momentStrip(view);
  const share = talkShare(view);
  const arc = moodArc(view);

  return (
    <>
      <Who name={view.prospect.name || view.prospect.company} role={role(view.prospect)} kicker={`Call ended${view.endedAt ? ` · ${formatDuration(view.endedAt - view.startedAt)}` : ''}`} />
      <main className="sp-main">
        {state.error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{state.error}</span>
          </p>
        )}
        <OutcomeCard view={view} />

        <Section label="The call at a glance">
          {strip.length > 0 && (
            <div className="sp-strip">
              <div className="sp-strip__bar" role="img" aria-label={`Moments: ${strip.map((m) => m.label).join(', ')}`}>
                {strip.map((m, i) => (
                  <span key={i} className={`sp-strip__seg cue-fam-${m.family}`} />
                ))}
              </div>
              <ol className="sp-strip__labels">
                {strip.map((m, i) => (
                  <li key={i}>{m.label}</li>
                ))}
              </ol>
            </div>
          )}
          <dl className="sp-stats">
            <div className="sp-stat">
              <dt className="cue-label">Lines used</dt>
              <dd className="cue-num">
                {landed.length} of {view.history.length}
              </dd>
            </div>
            <div className="sp-stat">
              <dt className="cue-label">You talked</dt>
              <dd className="cue-num">{share === null ? '–' : `${Math.round(share * 100)}%`}</dd>
            </div>
            <div className="sp-stat">
              <dt className="cue-label">Mood</dt>
              <dd>{arc ? `${RECEPTIVITY_LABEL[receptivityFromScore(arc.from)]} → ${RECEPTIVITY_LABEL[receptivityFromScore(arc.to)]}` : '–'}</dd>
            </div>
          </dl>
        </Section>

        <Section label="Summary" meta={view.review ? "Cue's review" : 'writing'}>
          {view.review ? (
            <>
              <p className="sp-prose">{view.review.summary}</p>
              {view.review.coaching[0] && (
                <p className="sp-inline-note">
                  <b>Next time:</b>&nbsp;{view.review.coaching[0]}
                </p>
              )}
            </>
          ) : (
            <p className="sp-quiet">Cue is reading the call back. The review shows here in a moment.</p>
          )}
        </Section>

        {landed.length > 0 && (
          <Section label="Lines that landed">
            <ul className="sp-landed">
              {landed.map((h) => (
                <li key={h.suggestion.id}>
                  <Icon name="check" size={14} />
                  <span className="sp-landed__line">“{h.suggestion.say}”</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>
      <footer className="sp-dock" aria-label="Next">
        {next && (
          <p className="sp-next">
            <span className="cue-label">Next</span> <b>{next.name || next.phone}</b>
            {role(next) ? ` · ${role(next)}` : ''}
          </p>
        )}
        <div className="sp-dock__row">
          <Button variant="primary" icon="arrow-right" onClick={() => void request({ type: 'session.reset' })}>
            Next call
          </Button>
          <a className="sp-link" href={webAppRoute(settings, `debrief/${encodeURIComponent(view.id)}`)} target="_blank" rel="noreferrer">
            Full debrief
            <Icon name="external" size={12} />
            <span className="cue-vh"> (opens the Cue app in a new tab)</span>
          </a>
        </div>
      </footer>
    </>
  );
}

/**
 * The outcome, and the one tap that confirms it. Trellus's disposition arrives on its own a little
 * after the hang-up; until then the rep can tap what happened.
 */
function OutcomeCard({ view }: { view: CallView }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = view.feedback?.outcome ?? view.outcome?.outcome ?? null;
  const confirmed = !!view.feedback;

  const confirm = async (outcome: Outcome) => {
    setBusy(true);
    setError(null);
    const res = await request({ type: 'session.feedback', feedback: { outcome, helpful: [], unhelpful: [] } });
    setBusy(false);
    if (res.ok) setPicking(false);
    else setError(res.error);
  };

  return (
    <section className="sp-card sp-outcome" aria-label="Outcome">
      <span className="cue-label">{confirmed ? 'Outcome · confirmed' : view.outcome ? `Outcome · ${SOURCE_WORDS[view.outcome.source] ?? view.outcome.source}` : 'Outcome'}</span>
      {o ? (
        <p className={`sp-outcome__word${o === 'meeting_booked' ? ' is-win' : ''}`}>
          {o === 'meeting_booked' && <Icon name="check" size={20} />}
          {OUTCOME_LABEL[o]}
        </p>
      ) : (
        <p className="sp-outcome__wait">Waiting for Trellus to log it…</p>
      )}
      {!confirmed && o && !picking && (
        <div className="sp-outcome__actions">
          <Button variant="primary" loading={busy} onClick={() => void confirm(o)}>
            Looks right
          </Button>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            Not quite
          </Button>
        </div>
      )}
      {!confirmed && (!o || picking) && (
        <div className="sp-outcome__pick">
          <span className="sp-quiet">{o ? 'What happened?' : 'Or tap what happened:'}</span>
          <OutcomeBar onOutcome={(x) => void confirm(x)} value={null} />
        </div>
      )}
      <p className="sp-quiet">{confirmed ? 'Thanks. This call now counts toward which lines book meetings.' : 'One tap teaches Cue which lines book meetings. Skip it and the Trellus outcome is used.'}</p>
      {error && (
        <p className="sp-inline-note sp-inline-note--warn" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
