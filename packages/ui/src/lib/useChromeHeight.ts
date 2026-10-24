import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes an element's height as a CSS variable on the dashboard frame (`.cue-dash`, else the
 * document), so sticky toolbars and full-window bands can sit exactly below the chrome even when
 * the band wraps onto two rows. Cleared on unmount.
 */
export function useChromeHeight(ref: RefObject<HTMLElement | null>, name: '--appbar-h' | '--toolbar-h'): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = (el.closest('.cue-dash') as HTMLElement | null) ?? document.documentElement;
    const set = () => host.style.setProperty(name, `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return () => host.style.removeProperty(name);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty(name);
    };
  }, [ref, name]);
}
