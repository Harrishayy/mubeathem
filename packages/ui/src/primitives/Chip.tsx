import type { MomentFamily } from '@cue/core';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info';

export interface ChipProps {
  children: ReactNode;
  /** Colour by moment family (wins over tone). */
  family?: MomentFamily;
  tone?: ChipTone;
  icon?: IconName;
  size?: 'sm' | 'md';
  /** Makes the chip a toggle button. */
  onClick?: () => void;
  selected?: boolean;
  title?: string;
  className?: string;
}

/** Small label. Static by default; a toggle button when onClick is passed. Never colour alone: always text. */
export function Chip({ children, family, tone = 'neutral', icon, size = 'md', onClick, selected, title, className }: ChipProps) {
  const cls = cx('cue-chip', `cue-chip--${size}`, family ? `cue-fam-${family} cue-chip--family` : `cue-chip--${tone}`, onClick && 'cue-chip--button', selected && 'is-selected', className);
  const body = (
    <>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 14} />}
      <span className="cue-chip__label">{children}</span>
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={selected ?? false} title={title}>
        {body}
      </button>
    );
  return (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

/** Keyboard hint, rendered as <kbd>. Hidden on touch-only devices. */
export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="cue-kbd-group">
      {keys.map((k) => (
        <kbd key={k} className="cue-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Content for screen readers only. */
export function VisuallyHidden({ children, as: As = 'span' }: { children: ReactNode; as?: 'span' | 'div' | 'h2' | 'h3' }) {
  return <As className="cue-vh">{children}</As>;
}
