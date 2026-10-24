import type { PolicyVerdict, Suggestion } from '@cue/core';
import { forwardRef, useId, useImperativeHandle } from 'react';
import { cx } from '../lib/cx';
import { Button, IconButton } from '../primitives/Button';
import { cueLabel, Line, type OnSuggestionAction, type SuggestionCardHandle } from './SuggestionCard';

export const VERDICT_LABEL: Record<PolicyVerdict, string> = {
  violation: "Can't promise this",
  supported: 'Within policy',
  insufficient_information: 'Not enough to go on',
  inconsistent_context: "Doesn't match the call",
  unsure: 'Check after the call',
};

export interface ComplianceCardProps {
  suggestion: Suggestion;
  onAction?: OnSuggestionAction;
  /** The cue's number in the call, printed in the margin. */
  cue?: number;
  className?: string;
}

/**
 * A hold cue: what was said, struck through; the rule it breaks; and a safe rephrase in the line's
 * voice. The margin rule is caution tape. The card pulses once on arrival (the only pulse in Cue)
 * and is announced as an alert.
 */
export const ComplianceCard = forwardRef<SuggestionCardHandle, ComplianceCardProps>(function ComplianceCard({ suggestion: s, onAction, cue, className }, ref) {
  const id = useId();
  useImperativeHandle(ref, () => ({
    use: () => onAction?.(s.id, 'used'),
    dismiss: () => onAction?.(s.id, 'dismissed'),
    edit: () => {},
    thumbsUp: () => onAction?.(s.id, 'thumbs_up'),
    thumbsDown: () => onAction?.(s.id, 'thumbs_down'),
  }));
  const c = s.compliance;
  const rephrase = c?.rephrase ?? s.say;
  return (
    <article className={cx('cue-card', 'cue-card--hero', 'cue-card--compliance', 'cue-fam-compliance', className)} aria-labelledby={id} role="alert">
      <header className="cue-card__slug">
        {cue !== undefined && <span className="cue-card__cue">{cueLabel(cue)}</span>}
        <span className="cue-moment cue-moment--md cue-fam-compliance">
          <i className="cue-moment__key" aria-hidden />
          <span className="cue-moment__kind">Hold</span>
        </span>
        <span className="cue-card__who">{VERDICT_LABEL[c?.verdict ?? 'violation']}</span>
      </header>
      {c && (
        <dl className="cue-comply">
          <dt className="cue-label">You said</dt>
          <dd className="cue-comply__claim">
            <s>{c.claim}</s>
          </dd>
          <dt className="cue-label">Rule</dt>
          <dd className="cue-comply__rule">{c.rule}</dd>
        </dl>
      )}
      <p className="cue-comply__try cue-label" id={id}>
        Try instead
      </p>
      <Line text={rephrase} size="hero" />
      {onAction && (
        <footer className="cue-card__actions">
          <Button variant="primary" icon="check" className="cue-card__use" onClick={() => onAction(s.id, 'used')}>
            Got it
          </Button>
          <span className="cue-card__tools">
            <IconButton icon="close" label="Dismiss" size="sm" onClick={() => onAction(s.id, 'dismissed')} />
          </span>
        </footer>
      )}
    </article>
  );
});
