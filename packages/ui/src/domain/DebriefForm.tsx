import { ATTITUDES, OUTCOME_LABEL, type Attitude, type CallView, type FeedbackRequest, type Outcome } from '@cue/core';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx';
import { formatDuration } from '../lib/core';
import { Sprout } from '../mascot/Sprout';
import { Button, IconButton } from '../primitives/Button';
import { Kbd } from '../primitives/Chip';
import { ErrorState } from '../primitives/Feedback';
import { TextArea, TextField } from '../primitives/Field';
import { Rating } from '../primitives/Rating';
import { MomentChip } from './MomentChip';

export interface DebriefFormProps {
  view: CallView;
  onSubmit: (f: FeedbackRequest) => Promise<void>;
  onSkip?: () => void;
  /** Focus the outcome group on mount (default true). */
  autoFocus?: boolean;
  className?: string;
}

/** Outcomes in the order reps reach for them. `unknown` is never offered. */
export const DEBRIEF_OUTCOMES: Outcome[] = ['meeting_booked', 'follow_up', 'callback_requested', 'not_interested', 'gatekeeper_blocked', 'voicemail', 'no_answer', 'wrong_person'];

const ATTITUDE_LABEL: Record<Attitude, string> = { friendly: 'Friendly', curious: 'Curious', neutral: 'Neutral', guarded: 'Guarded', irritated: 'Irritated', hostile: 'Hostile' };

/** A keyboard-first radio group drawn as chips. Arrows move; number keys jump. */
function ChipRadio<V extends string>({ label, options, value, onChange, labels, error, id }: { label: string; options: V[]; value: V | null; onChange: (v: V) => void; labels: Record<V, string>; error?: string; id: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = value ? options.indexOf(value) : -1;
  const onKeyDown = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + options.length) % options.length;
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= options.length) next = Number(e.key) - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div className={cx('cue-debrief__group', error && 'has-error')}>
      <p className="cue-debrief__label" id={id}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} aria-describedby={error ? `${id}-err` : undefined} aria-required="true" className="cue-chipradio" onKeyDown={onKeyDown}>
        {options.map((o, i) => (
          <button
            key={o}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === o}
            tabIndex={value === o || (idx < 0 && i === 0) ? 0 : -1}
            className={cx('cue-chipradio__opt', o === 'meeting_booked' && 'is-win')}
            onClick={() => onChange(o)}
          >
            {labels[o]}
          </button>
        ))}
      </div>
      {error && (
        <p className="cue-field__msg cue-field__msg--error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The post-call debrief: one screen, keyboard first, ≤ 20 s. Outcome is required; everything else is
 * optional. ⌘/Ctrl + Enter submits from anywhere in the form.
 */
export function DebriefForm({ view, onSubmit, onSkip, autoFocus = true, className }: DebriefFormProps) {
  const ids = { outcome: useId(), attitude: useId(), cards: useId() };
  const [outcome, setOutcome] = useState<Outcome | null>(view.outcome?.outcome && view.outcome.outcome !== 'unknown' ? view.outcome.outcome : null);
  const [rating, setRating] = useState<number | null>(null);
  const [attitude, setAttitude] = useState<Attitude | null>(null);
  const [whatWorked, setWhatWorked] = useState('');
  const [whatDidnt, setWhatDidnt] = useState('');
  const [betterLine, setBetterLine] = useState('');
  const [verdicts, setVerdicts] = useState<Record<string, 'up' | 'down' | undefined>>(() =>
    Object.fromEntries(view.history.map((h) => [h.suggestion.id, h.action === 'thumbs_up' ? 'up' : h.action === 'thumbs_down' ? 'down' : undefined])),
  );
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const firstRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (autoFocus) firstRef.current?.querySelector<HTMLButtonElement>('[role="radio"][tabindex="0"]')?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = async () => {
    setTried(true);
    if (!outcome) {
      firstRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
      return;
    }
    setState('saving');
    setErr(null);
    const f: FeedbackRequest = {
      outcome,
      rating: rating ?? undefined,
      attitude: attitude ?? undefined,
      whatWorked: whatWorked.trim() || undefined,
      whatDidnt: whatDidnt.trim() || undefined,
      betterLine: betterLine.trim() || undefined,
      helpful: Object.entries(verdicts).filter(([, v]) => v === 'up').map(([k]) => k),
      unhelpful: Object.entries(verdicts).filter(([, v]) => v === 'down').map(([k]) => k),
    };
    try {
      await onSubmit(f);
      setState('saved');
    } catch (e) {
      setState('error');
      setErr(e instanceof Error ? e.message : 'The server did not take it.');
    }
  };

  if (state === 'saved')
    return (
      <div className={cx('cue-debrief', 'is-saved', className)} role="status">
        <Sprout state={outcome === 'meeting_booked' ? 'celebrating' : 'learning'} size={88} growth={0.6} />
        <p className="cue-debrief__done">Thanks. Cue is learning from this call.</p>
        <p className="cue-debrief__done-sub">Your notes go into tonight's playbook update and the next review.</p>
      </div>
    );

  const duration = view.endedAt ? formatDuration(view.endedAt - view.startedAt) : null;

  return (
    <form
      ref={firstRef}
      className={cx('cue-debrief', className)}
      aria-label="Call debrief"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <header className="cue-debrief__head">
        <div>
          <h2 className="cue-debrief__title">How did it go?</h2>
          <p className="cue-debrief__sub">
            {[view.prospect.name, view.prospect.company, duration].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Sprout state="idle" size={44} decorative />
      </header>

      <ChipRadio id={ids.outcome} label="Outcome" options={DEBRIEF_OUTCOMES} value={outcome} onChange={setOutcome} labels={OUTCOME_LABEL} error={tried && !outcome ? 'Pick an outcome to save the call.' : undefined} />

      <div className="cue-debrief__row">
        <div className="cue-debrief__group">
          <p className="cue-debrief__label">How did the call feel?</p>
          <Rating label="How did the call feel?" value={rating} onChange={setRating} />
        </div>
        <ChipRadio id={ids.attitude} label="The prospect was" options={[...ATTITUDES]} value={attitude} onChange={setAttitude} labels={ATTITUDE_LABEL} />
      </div>

      <div className="cue-debrief__row">
        <TextArea label="What worked" optional value={whatWorked} onChange={(e) => setWhatWorked(e.target.value)} maxLength={1000} placeholder="The joke landed; she laughed." />
        <TextArea label="What didn't" optional value={whatDidnt} onChange={(e) => setWhatDidnt(e.target.value)} maxLength={1000} placeholder="Lost her on the price question." />
      </div>
      <TextField label="A better line" optional value={betterLine} onChange={(e) => setBetterLine(e.target.value)} maxLength={400} hint="What you said that worked, or wish you'd had. Good ones join the playbook." />

      {view.history.length > 0 && (
        <fieldset className="cue-debrief__cards">
          <legend className="cue-debrief__label" id={ids.cards}>
            Which cards helped?
          </legend>
          <ul>
            {view.history.map(({ suggestion: s }) => {
              const v = verdicts[s.id];
              return (
                <li key={s.id} className="cue-debrief__card">
                  <MomentChip moment={s.situation.moment} size="sm" />
                  <span className="cue-debrief__card-line">{s.kind === 'compliance' ? s.compliance?.rephrase ?? s.say : s.say}</span>
                  <span className="cue-debrief__card-votes">
                    <IconButton icon="thumbs-up" label="Helped" size="sm" pressed={v === 'up'} onClick={() => setVerdicts((m) => ({ ...m, [s.id]: v === 'up' ? undefined : 'up' }))} />
                    <IconButton icon="thumbs-down" label="Didn't help" size="sm" pressed={v === 'down'} onClick={() => setVerdicts((m) => ({ ...m, [s.id]: v === 'down' ? undefined : 'down' }))} />
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {state === 'error' && err && <ErrorState compact title="Couldn't save the debrief" message={err} onRetry={() => void submit()} />}

      <footer className="cue-debrief__foot">
        <Button type="submit" variant="primary" size="lg" icon="check" loading={state === 'saving'}>
          Save debrief
        </Button>
        <span className="cue-debrief__hint">
          <Kbd keys={['⌘', 'Enter']} />
        </span>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} className="cue-debrief__skip">
            Skip
          </Button>
        )}
      </footer>
    </form>
  );
}
