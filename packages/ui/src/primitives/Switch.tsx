import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off setting. The whole row is the hit target. */
export function Switch({ label, checked, onCheckedChange, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <label className={cx('cue-switch', disabled && 'is-disabled', className)} htmlFor={id}>
      <span className="cue-switch__text">
        <span className="cue-switch__label">{label}</span>
        {description && <span className="cue-switch__desc">{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="cue-switch__track"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="cue-switch__thumb" aria-hidden />
      </button>
    </label>
  );
}
