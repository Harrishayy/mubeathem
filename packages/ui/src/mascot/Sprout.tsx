import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';
import type { MascotState } from '../lib/core';

export const SPROUT_LABEL: Record<MascotState, string> = {
  idle: 'Cue is ready',
  listening: 'Cue is listening',
  thinking: 'Cue is reading the moment',
  suggesting: 'Cue has a suggestion',
  warning: 'Cue flagged something to check',
  celebrating: 'Meeting booked',
  learning: 'Cue is learning from your calls',
  offline: 'Cue is offline',
};

export interface SproutProps {
  state: MascotState;
  /** Rendered size in px. Reads at 20 (collapsed bar) through 96+ (empty states, celebrations). */
  size?: number;
  /** Prospect voice level 0..1; drives the listening ring. */
  voiceLevel?: number;
  /** Learning progress 0..1 (examples / adapter threshold); grows the third leaf, blooms at 1. */
  growth?: number;
  /** Next to text that already says the state, pass decorative. */
  decorative?: boolean;
  className?: string;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Sprout: a seedling in a honey soil pod, the model growing on your team's calls. Pure function of
 * its props; all motion is CSS keyed on data-state, with a static pose per state under reduced
 * motion. Colours come from --sprout-* tokens.
 */
export function Sprout({ state, size = 40, voiceLevel = 0, growth, decorative, className }: SproutProps) {
  const g = growth === undefined ? 0 : clamp(growth);
  const style = { '--level': clamp(voiceLevel), '--growth': g } as CSSProperties;
  const small = size < 30;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cx('cue-sprout', small && 'is-small', className)}
      data-state={state}
      data-bloom={state === 'celebrating' || g >= 1 || undefined}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : SPROUT_LABEL[state]}
      aria-hidden={decorative || undefined}
    >
      <circle className="sp-ring" cx="24" cy="25" r="22" />
      <circle className="sp-pulse" cx="24" cy="25" r="22" />
      <g className="sp-plant">
        <path className="sp-stem" d="M24 31.5C24 26 24.6 21.5 24 16" />
        <g className="sp-leaf sp-leaf-l">
          <path d="M24 22.5C18.6 23 13.2 19.8 11.6 12.6 18.4 11.6 23 15.8 24 22.5Z" />
          <path className="sp-vein" d="M23.4 21.8C20 18.8 17 16.3 13.9 13.9" />
        </g>
        <g className="sp-leaf sp-leaf-r">
          <path d="M24 18.2C25.1 11.6 30.2 7 37.4 7.6 36.8 14.7 31.2 18.8 24 18.2Z" />
          <path className="sp-vein" d="M24.6 17.6C28 14.6 31.2 11.6 35.3 9.2" />
        </g>
        <g className="sp-leaf sp-leaf-new">
          <path d="M24 27C26.7 27.3 30.3 25.6 31.3 21.9 27.7 21.5 24.6 23.6 24 27Z" />
        </g>
        <g className="sp-bloom">
          <circle cx="24" cy="11.6" r="2.7" />
          <circle cx="27.1" cy="13.8" r="2.7" />
          <circle cx="25.9" cy="17.4" r="2.7" />
          <circle cx="22.1" cy="17.4" r="2.7" />
          <circle cx="20.9" cy="13.8" r="2.7" />
          <circle className="sp-bloom-core" cx="24" cy="14.9" r="2" />
        </g>
      </g>
      <g className="sp-pod">
        <path d="M8.6 30.6h30.8a1.4 1.4 0 0 1 1.4 1.6C40 39.8 33.4 45.2 24 45.2S8 39.8 7.2 32.2a1.4 1.4 0 0 1 1.4-1.6Z" />
        <path className="sp-soil" d="M10 31.2c3.6 1.6 24.4 1.6 28 0" />
        {!small && (
          <>
            <circle className="sp-cheek" cx="15.2" cy="38.6" r="1.7" />
            <circle className="sp-cheek" cx="32.8" cy="38.6" r="1.7" />
          </>
        )}
        <g className="sp-eyes">
          <circle cx="19.3" cy="36.2" r={small ? 2.3 : 1.9} />
          <circle cx="28.7" cy="36.2" r={small ? 2.3 : 1.9} />
        </g>
        <path className="sp-eyes-shut" d="M17.6 36.4h3.4M27 36.4h3.4" />
        {!small && <path className="sp-mouth" d="M22 39.4q2 1.7 4 0" />}
        {!small && <path className="sp-mouth-flat" d="M22.2 40h3.6" />}
      </g>
      <g className="sp-dots">
        <circle cx="37.5" cy="5" r="1.6" />
        <circle cx="41.5" cy="5" r="1.6" />
        <circle cx="45.5" cy="5" r="1.6" />
      </g>
      {state === 'celebrating' && (
        <g className="sp-confetti">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} style={{ '--i': i } as CSSProperties} d="M24 20c1.4-1.6 3.4-1.8 4.4-1.4-.4 1.8-2.4 2.8-4.4 1.4Z" />
          ))}
        </g>
      )}
    </svg>
  );
}
