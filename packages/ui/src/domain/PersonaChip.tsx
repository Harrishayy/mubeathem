import { PERSONA_LABEL, type Persona } from '@cue/core';
import { cx } from '../lib/cx';
import { formatPercent } from '../lib/core';

export interface PersonaChipProps {
  persona: Persona;
  /** 0..1. Below 0.6 the chip reads as a guess. */
  confidence?: number;
  className?: string;
}

/** Who Cue thinks is on the line. A low-confidence read shows as a guess, in words not just style. */
export function PersonaChip({ persona, confidence, className }: PersonaChipProps) {
  const unsure = confidence !== undefined && confidence < 0.6;
  const label = PERSONA_LABEL[persona];
  const sr = confidence === undefined ? `Talking to: ${label}` : `Talking to: ${label}, ${formatPercent(confidence)} sure`;
  return (
    <span className={cx('cue-persona', unsure && 'is-unsure', className)} aria-label={sr} title={sr}>
      <span aria-hidden>{label}</span>
      {unsure && <span className="cue-persona__q" aria-hidden>?</span>}
    </span>
  );
}
