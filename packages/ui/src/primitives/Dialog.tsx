import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Shown in the header and used as the accessible name. */
  title: ReactNode;
  /** Small margin-capitals line above the title ("Debrief"). */
  eyebrow?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  children: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * A modal over the current screen, for work that belongs to where the user already is (the debrief
 * after a call). Built on the native <dialog>: showModal() gives focus trapping, Escape and an inert
 * page underneath for free. It stays inside <CueRoot>, so the tokens carry into the top layer.
 * Below 560 px it becomes a full-height sheet so long forms still scroll.
 */
export function Dialog({ open, onClose, title, eyebrow, description, children, size = 'md', className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  // Escape fires `cancel`: keep React in charge of the open state.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx('cue-dialog', `cue-dialog--${size}`, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="cue-dialog__frame">
          <header className="cue-dialog__head">
            <div className="cue-dialog__titles">
              {eyebrow && <p className="cue-label cue-dialog__eyebrow">{eyebrow}</p>}
              <h2 className="cue-dialog__title" id={titleId}>
                {title}
              </h2>
              {description && (
                <p className="cue-dialog__desc" id={descId}>
                  {description}
                </p>
              )}
            </div>
            <IconButton icon="close" label="Close" size="sm" onClick={onClose} className="cue-dialog__close" />
          </header>
          <div className="cue-dialog__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
