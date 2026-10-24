import { forwardRef, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  count?: { value: number; max?: number };
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}

function FieldShell({ id, label, hint, error, count, optional, children, className }: FieldShellProps) {
  const near = count?.max !== undefined && count.value >= count.max * 0.8;
  return (
    <div className={cx('cue-field', error && 'has-error', className)}>
      <div className="cue-field__top">
        <label className="cue-field__label" htmlFor={id}>
          {label}
          {optional && <span className="cue-field__optional"> (optional)</span>}
        </label>
        {near && count && (
          <span className={cx('cue-field__count', count.max !== undefined && count.value > count.max && 'is-over')} aria-live="polite">
            {count.value}/{count.max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="cue-field__msg cue-field__msg--error" id={`${id}-msg`}>
          {error}
        </p>
      ) : hint ? (
        <p className="cue-field__msg" id={`${id}-msg`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}

/** Single-line text with an always-visible label. Error replaces the hint and is announced. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, optional, className, id, maxLength, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const len = typeof rest.value === 'string' ? rest.value.length : 0;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} optional={optional} count={maxLength ? { value: len, max: maxLength } : undefined} className={className}>
      <input
        ref={ref}
        id={fid}
        className="cue-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        maxLength={maxLength}
        {...rest}
      />
    </FieldShell>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Grow with the content up to maxRows. */
  autosize?: boolean;
  maxRows?: number;
}

/** Multi-line text. Autosizes by default; a counter appears near maxLength. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, optional, className, id, autosize = true, maxRows = 8, rows = 2, maxLength, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const len = typeof rest.value === 'string' ? rest.value.length : 0;
  useLayoutEffect(() => {
    const el = inner.current;
    if (!autosize || !el) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight + 2, lh * maxRows + 20)}px`;
  }, [rest.value, autosize, maxRows]);
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} optional={optional} count={maxLength ? { value: len, max: maxLength } : undefined} className={className}>
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        id={fid}
        rows={rows}
        className="cue-input cue-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        maxLength={maxLength}
        {...rest}
      />
    </FieldShell>
  );
});
