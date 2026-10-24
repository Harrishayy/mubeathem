import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCue } from '../domain/CueRoot';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface ToastData {
  id: string;
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms before it dismisses itself; null keeps it until dismissed. Default 5000. */
  duration?: number | null;
}

const TONE_ICON: Record<ToastTone, IconName> = { neutral: 'info', ok: 'check', warn: 'alert', bad: 'alert' };

/** One toast. The timer pauses while hovered or focused and while the tab is hidden. */
export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const { tone = 'neutral', duration = 5000 } = toast;
  const [paused, setPaused] = useState(false);
  const left = useRef(duration ?? 0);
  useEffect(() => {
    if (duration === null || paused) return;
    const started = Date.now();
    const id = setTimeout(() => onDismiss(toast.id), left.current);
    const onVis = () => {
      if (document.hidden) {
        clearTimeout(id);
        left.current -= Date.now() - started;
        setPaused(true);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - started));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [duration, paused, onDismiss, toast.id]);
  useEffect(() => {
    if (!paused) return;
    const onVis = () => !document.hidden && setPaused(false);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [paused]);

  return (
    <div
      className={cx('cue-toast', `cue-toast--${tone}`)}
      role={tone === 'bad' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={TONE_ICON[tone]} size={18} className="cue-toast__icon" />
      <div className="cue-toast__text">
        <p className="cue-toast__title">{toast.title}</p>
        {toast.description && <p className="cue-toast__desc">{toast.description}</p>}
      </div>
      {toast.action && (
        <button type="button" className="cue-toast__action" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="cue-toast__close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/**
 * Stack of toasts at the bottom of the CueRoot layer. Newest at the bottom; enter and exit from
 * the same edge so swipe direction would read naturally.
 */
export function ToastRegion({ toasts, onDismiss, inline }: { toasts: ToastData[]; onDismiss: (id: string) => void; inline?: boolean }) {
  const { layer } = useCue();
  const list = (
    <ol className={cx('cue-toasts', inline && 'cue-toasts--inline')} aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.li
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.14 } }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            <Toast toast={t} onDismiss={onDismiss} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
  if (inline || !layer) return list;
  return createPortal(list, layer);
}
