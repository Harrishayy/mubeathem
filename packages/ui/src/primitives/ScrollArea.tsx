import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ScrollAreaProps {
  children: ReactNode;
  maxHeight?: number | string;
  className?: string;
  /** Accessible name when the region is focusable for keyboard scrolling. */
  label?: string;
  onScroll?: (el: HTMLDivElement) => void;
}

/**
 * Native scrolling with edge fades that appear only when there is more to see. Focusable (so keyboard
 * users can scroll) when labelled.
 */
export const ScrollArea = forwardRef<HTMLDivElement | null, ScrollAreaProps>(function ScrollArea({ children, maxHeight, className, label, onScroll }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLDivElement);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const n = el.current;
    if (!n) return;
    setEdges({ top: n.scrollTop > 2, bottom: n.scrollTop + n.clientHeight < n.scrollHeight - 2 });
  }, []);
  useEffect(() => {
    measure();
    const n = el.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(n);
    if (n.firstElementChild) ro.observe(n.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div
      ref={el}
      className={cx('cue-scroll', edges.top && 'has-top', edges.bottom && 'has-bottom', className)}
      style={{ maxHeight }}
      tabIndex={label ? 0 : undefined}
      role={label ? 'region' : undefined}
      aria-label={label}
      onScroll={(e) => {
        measure();
        onScroll?.(e.currentTarget);
      }}
    >
      <div className="cue-scroll__content">{children}</div>
    </div>
  );
});
