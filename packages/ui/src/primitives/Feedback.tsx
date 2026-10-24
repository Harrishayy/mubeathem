import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Button } from './Button';
import { Icon } from './Icon';

/** Loading placeholder with a soft shimmer (static under reduced motion). */
export function Skeleton({ width, height = 14, radius, className, lines }: { width?: number | string; height?: number; radius?: number; className?: string; lines?: number }) {
  if (lines && lines > 1)
    return (
      <span className={cx('cue-skel-lines', className)} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="cue-skel" style={{ width: i === lines - 1 ? '62%' : '100%', height } as CSSProperties} />
        ))}
      </span>
    );
  return <span className={cx('cue-skel', className)} style={{ width, height, borderRadius: radius } as CSSProperties} aria-hidden />;
}

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  /** Usually <Sprout size={72} />. */
  art?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** An empty state that says what will appear here and how to get it. */
export function EmptyState({ title, children, art, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('cue-empty', compact && 'cue-empty--compact', className)}>
      {art && <div className="cue-empty__art">{art}</div>}
      <p className="cue-empty__title">{title}</p>
      {children && <div className="cue-empty__body">{children}</div>}
      {action && <div className="cue-empty__action">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
}

/** Something failed: what, and what to do. Retry is optional. */
export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', compact, className }: ErrorStateProps) {
  return (
    <div className={cx('cue-error', compact && 'cue-error--compact', className)} role="alert">
      <Icon name="alert" size={compact ? 16 : 20} className="cue-error__icon" />
      <div className="cue-error__text">
        <p className="cue-error__title">{title}</p>
        <p className="cue-error__msg">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
