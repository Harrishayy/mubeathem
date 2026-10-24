import { AnimatePresence, motion, useAnimationControls, useDragControls, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export type SheetSnap = 'half' | 'full';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name; shown as the header unless hideTitle. */
  title: string;
  hideTitle?: boolean;
  /** Modal sheets dim the page and trap attention; the in-call sheet is not modal. */
  modal?: boolean;
  /** Resting heights, lowest first. Default ['full']. With 'half' the sheet opens at half height. */
  snapPoints?: SheetSnap[];
  /** Fires when the sheet settles on a new snap point. */
  onSnapChange?: (snap: SheetSnap) => void;
  children: ReactNode;
  className?: string;
}

const FLICK = 500;
const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Mobile bottom sheet with a drag handle and optional half-height snap. Drag or flick between snap
 * points; drag below the lowest (or flick down from it) to close. Escape closes; the handle is a
 * button that toggles half ↔ full for keyboard users. Reduced motion turns the slides into fades.
 */
export function Sheet({ open, onClose, title, hideTitle, modal = false, snapPoints = ['full'], onSnapChange, children, className }: SheetProps) {
  const drag = useDragControls();
  const controls = useAnimationControls();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [snap, setSnap] = useState<SheetSnap>(snapPoints[0] ?? 'full');
  const points = snapPoints.length ? snapPoints : (['full'] as SheetSnap[]);

  /** translateY for a snap point: 0 = full height, more = lower. */
  const offset = useCallback(
    (p: SheetSnap) => {
      if (p === 'full' || !height || typeof window === 'undefined') return 0;
      return Math.max(0, height - window.innerHeight * 0.5);
    },
    [height],
  );

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (open) setSnap(points[0] ?? 'full');
  }, [open]);

  useEffect(() => {
    if (open) void controls.start({ y: offset(snap), transition: { duration: 0.36, ease: EASE } });
  }, [open, snap, offset, controls]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    if (modal) ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, modal, onClose]);

  const settle = (p: SheetSnap) => {
    if (p === snap) void controls.start({ y: offset(p), transition: { duration: 0.3, ease: EASE } });
    setSnap(p);
    onSnapChange?.(p);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const idx = points.indexOf(snap);
    const at = offset(snap) + info.offset.y;
    if (info.velocity.y > FLICK) return idx <= 0 ? onClose() : settle(points[idx - 1]!);
    if (info.velocity.y < -FLICK) return settle(points[Math.min(points.length - 1, idx + 1)]!);
    // Nearest resting place, with "closed" sitting at the sheet's full height.
    const stops = [...points.map((p) => ({ p, y: offset(p) })), { p: 'closed' as const, y: height }];
    const near = stops.reduce((a, b) => (Math.abs(b.y - at) < Math.abs(a.y - at) ? b : a));
    if (near.p === 'closed') onClose();
    else settle(near.p);
  };

  const canToggle = points.length > 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          {modal && (
            <motion.div key="scrim" className="cue-sheet__scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.24 }} onClick={onClose} />
          )}
          <motion.div
            key="sheet"
            ref={ref}
            role="dialog"
            aria-modal={modal || undefined}
            aria-labelledby={id}
            tabIndex={-1}
            className={cx('cue-sheet', className)}
            data-snap={snap}
            initial={{ y: '100%' }}
            animate={controls}
            exit={{ y: '100%', transition: { duration: 0.22, ease: EASE } }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: height || 1000 }}
            dragElastic={{ top: 0.04, bottom: 0.2 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
          >
            <div className="cue-sheet__handle-zone" onPointerDown={(e) => drag.start(e)}>
              {canToggle ? (
                <button
                  type="button"
                  className="cue-sheet__handle-btn"
                  aria-label={snap === 'full' ? 'Show less' : 'Show more'}
                  onClick={() => settle(snap === 'full' ? points[0]! : 'full')}
                >
                  <span className="cue-sheet__handle" aria-hidden />
                </button>
              ) : (
                <span className="cue-sheet__handle" aria-hidden />
              )}
            </div>
            <h2 id={id} className={cx('cue-sheet__title', hideTitle && 'cue-vh')}>
              {title}
            </h2>
            <div className="cue-sheet__body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
