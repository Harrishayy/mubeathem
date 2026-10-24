import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useCue } from '../domain/CueRoot';

/** Once any tooltip has shown, neighbours open instantly for a moment (no delay, no animation). */
let lastClosedAt = 0;
const WARM_MS = 500;
const DELAY_MS = 450;

interface TooltipProps {
  label: string;
  children: ReactElement<{ ref?: Ref<HTMLElement>; 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom';
}

/**
 * Short hint on hover (after a delay) or keyboard focus (immediately). Rendered into the CueRoot
 * layer so overflow never clips it, positioned relative to that layer so it is correct inside a
 * Shadow DOM or a transformed container. Hidden from touch hover.
 */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const { layer } = useCue();
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null);

  const show = (immediate: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    const warm = Date.now() - lastClosedAt < WARM_MS;
    if (immediate || warm) {
      setInstant(warm);
      setOpen(true);
    } else timer.current = setTimeout(() => (setInstant(false), setOpen(true)), DELAY_MS);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen((was) => {
      if (was) lastClosedAt = Date.now();
      return false;
    });
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !layer || !tip.current) return;
    const t = trigger.current.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    const w = tip.current.offsetWidth;
    const h = tip.current.offsetHeight;
    const fitsTop = t.top - l.top - h - 8 > 4;
    const s = side === 'top' && fitsTop ? 'top' : side === 'bottom' || !fitsTop ? 'bottom' : 'top';
    const x = Math.min(Math.max(t.left - l.left + t.width / 2 - w / 2, 6), l.width - w - 6);
    const y = s === 'top' ? t.top - l.top - h - 8 : t.bottom - l.top + 8;
    setPos({ x, y, side: s });
  }, [open, layer, side, label]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const child = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      trigger.current = node;
      const own = (children.props as { ref?: Ref<HTMLElement> }).ref;
      if (typeof own === 'function') own(node);
      else if (own && typeof own === 'object') (own as { current: HTMLElement | null }).current = node;
    },
    'aria-describedby': open ? id : undefined,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && show(false),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => e.currentTarget.matches(':focus-visible') && show(true),
    onBlur: hide,
    onPointerDown: hide,
  } as never);

  return (
    <>
      {child}
      {open && layer &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="cue-tooltip"
            data-side={pos?.side ?? side}
            data-instant={instant || undefined}
            style={{ transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : undefined, visibility: pos ? 'visible' : 'hidden' }}
          >
            {label}
          </div>,
          layer,
        )}
    </>
  );
}
