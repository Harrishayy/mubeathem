import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string> {
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange: (v: V) => void;
  size?: 'sm' | 'md';
  /** Show `label` above the control (otherwise it is the accessible name only). */
  showLabel?: boolean;
  className?: string;
}

/** One of 2–5 options as a radio group. Arrow keys move the selection; the thumb slides. */
export function SegmentedControl<V extends string>({ label, options, value, onChange, size = 'md', showLabel, className }: SegmentedControlProps<V>) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (e: KeyboardEvent, delta: number) => {
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const rtl = (e.currentTarget as HTMLElement).closest('[dir="rtl"]') !== null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, rtl && e.key === 'ArrowRight' ? -1 : 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, rtl && e.key === 'ArrowLeft' ? 1 : -1);
  };
  const group = (
    <div
      role="radiogroup"
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? labelId : undefined}
      className={cx('cue-seg', `cue-seg--${size}`, className)}
      style={{ '--seg-n': options.length, '--seg-i': index } as React.CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="cue-seg__thumb" aria-hidden />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={o.value === value ? 0 : -1}
          className="cue-seg__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!showLabel) return group;
  return (
    <div className="cue-seg-field">
      <span className="cue-seg-field__label" id={labelId}>
        {label}
      </span>
      {group}
    </div>
  );
}
