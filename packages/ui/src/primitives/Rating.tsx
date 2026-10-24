import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx';

const LABELS = ['Terrible', 'Poor', 'OK', 'Good', 'Great'] as const;

export interface RatingProps {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  className?: string;
}

/** 1–5 rating drawn as leaves (Sprout's). A radio group: arrows move, the word says the value. */
export function Rating({ label, value, onChange, className }: RatingProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const cur = value ?? 0;
    let next = cur;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, cur + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, cur - 1);
    else if (/^[1-5]$/.test(e.key)) next = Number(e.key);
    else return;
    e.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  };
  return (
    <div className={cx('cue-rating', className)}>
      <div role="radiogroup" aria-label={label} className="cue-rating__group" onKeyDown={onKeyDown}>
        {LABELS.map((word, i) => {
          const n = i + 1;
          const on = value !== null && n <= value;
          return (
            <button
              key={word}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n}: ${word}`}
              tabIndex={value === n || (value === null && n === 1) ? 0 : -1}
              className={cx('cue-rating__leaf', on && 'is-on')}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => onChange(n)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <path d="M5 19C5 10 10.5 5 20 5c0 9.5-5 15-14 15Z" />
                <path className="cue-rating__vein" d="M5.5 18.5 14 10" />
              </svg>
            </button>
          );
        })}
      </div>
      <span className="cue-rating__word" aria-hidden>
        {value ? LABELS[value - 1] : 'Not rated'}
      </span>
    </div>
  );
}
