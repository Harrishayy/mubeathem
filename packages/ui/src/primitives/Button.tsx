import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  /** Keeps its width, shows a spinner and sets aria-busy. */
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

/** Every clickable action. At most one primary per pane. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconEnd, loading, block, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx('cue-btn', `cue-btn--${variant}`, `cue-btn--${size}`, block && 'cue-btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="cue-spinner" aria-hidden /> : icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children !== undefined && <span className="cue-btn__label">{children}</span>}
      {iconEnd && !loading && <Icon name={iconEnd} size={16} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: becomes the aria-label and the tooltip. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger' | 'primary';
  size?: 'sm' | 'md';
  /** Toggle buttons: sets aria-pressed. */
  pressed?: boolean;
  tooltip?: boolean;
}

/** Square icon-only button with a required label, shown as a tooltip on hover and focus. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', pressed, tooltip = true, className, type, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      aria-pressed={pressed}
      className={cx('cue-icon-btn', `cue-btn--${variant}`, `cue-icon-btn--${size}`, className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
  return tooltip ? <Tooltip label={label}>{btn}</Tooltip> : btn;
});
