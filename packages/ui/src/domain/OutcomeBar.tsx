import { OUTCOME_LABEL, type Outcome } from '@cue/core';
import { cx } from '../lib/cx';
import { Button } from '../primitives/Button';
import type { IconName } from '../primitives/Icon';

export interface OutcomeBarProps {
  onOutcome: (o: Outcome) => void;
  /** Highlights the outcome already recorded. */
  value?: Outcome | null;
  className?: string;
}

const QUICK: { o: Outcome; label: string; icon?: IconName }[] = [
  { o: 'meeting_booked', label: 'Booked', icon: 'calendar' },
  { o: 'follow_up', label: 'Follow-up' },
  { o: 'callback_requested', label: 'Callback' },
  { o: 'not_interested', label: 'Not interested' },
  { o: 'gatekeeper_blocked', label: 'Blocked' },
  { o: 'voicemail', label: 'Voicemail', icon: 'voicemail' },
  { o: 'no_answer', label: 'No answer' },
  { o: 'wrong_person', label: 'Wrong person' },
];

/** Quick taps at the end of a call. Nothing is pre-judged: only the chosen outcome gets the primary treatment. */
export function OutcomeBar({ onOutcome, value, className }: OutcomeBarProps) {
  return (
    <div className={cx('cue-outcomes', className)} role="group" aria-label="Call outcome">
      {QUICK.map(({ o, label, icon }) => (
        <Button
          key={o}
          size="md"
          variant={value === o ? 'primary' : 'secondary'}
          icon={value === o ? 'check' : icon}
          aria-pressed={value === o}
          title={OUTCOME_LABEL[o]}
          className={cx('cue-outcomes__btn', value === o && 'is-selected')}
          onClick={() => onOutcome(o)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
