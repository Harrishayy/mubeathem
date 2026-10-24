import { RECEPTIVITY_LABEL, receptivityFromScore } from '@cue/core';
import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { Icon } from '../primitives/Icon';

export interface ReceptivityMeterProps {
  /** -1 (cold) .. 1 (warm). */
  score: number;
  trend?: { tMs: number; score: number }[];
  /** Show the word (Warm / Neutral / Cooling / Cold) and the trend line. */
  label?: boolean;
  className?: string;
}

const BARS = 5;

/** Which way the last few reads moved: positive = warming. */
function drift(trend?: { score: number }[]): number {
  if (!trend || trend.length < 2) return 0;
  const recent = trend.slice(-3);
  return recent[recent.length - 1]!.score - recent[0]!.score;
}

/**
 * How receptive the prospect is: a five-cell scale that fills and drifts gold (warm) to ice (cold),
 * with the word and a drift arrow beside it. role="meter" exposes the number.
 */
export function ReceptivityMeter({ score, trend, label = true, className }: ReceptivityMeterProps) {
  const s = Math.max(-1, Math.min(1, score));
  const level = Math.round(((s + 1) / 2) * (BARS - 1)) + 1;
  const word = RECEPTIVITY_LABEL[receptivityFromScore(s)];
  const d = drift(trend);
  const dir = d > 0.15 ? 'warming' : d < -0.15 ? 'cooling' : null;
  const text = dir && word !== 'Cooling' ? `${word}, ${dir}` : word;
  const style = { '--warmth': `${Math.round(((s + 1) / 2) * 100)}%` } as CSSProperties;
  return (
    <span
      className={cx('cue-recept', label && 'has-label', className)}
      style={style}
      role="meter"
      aria-label="Receptivity"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(s.toFixed(2))}
      aria-valuetext={text}
      title={`Mood: ${text}`}
    >
      <span className="cue-recept__bars" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} className={i < level ? 'is-on' : undefined} />
        ))}
      </span>
      {label && (
        <span className="cue-recept__word" aria-hidden>
          {word}
          {dir && <Icon name="arrow-up-right" size={12} className={cx('cue-recept__arrow', dir === 'cooling' && 'is-down')} />}
        </span>
      )}
    </span>
  );
}
