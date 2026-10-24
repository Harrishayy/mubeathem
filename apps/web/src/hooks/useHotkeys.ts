import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

/** True when the key press belongs to a text field, so single-letter shortcuts stay out of the way. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !(t instanceof Element)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as HTMLElement).isContentEditable;
}

/**
 * Keys: `mod+.` (⌘ or Ctrl), single letters (`u`, `d`), `escape`. Letter keys are ignored while
 * typing or with a modifier held. Pass extra windows (the PiP window) to listen there too.
 */
export function useHotkeys(map: HotkeyMap, enabled = true, extraTargets: (Window | null | undefined)[] = []): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === '.') {
        const fn = ref.current['mod+.'];
        if (fn) {
          e.preventDefault();
          fn(e);
        }
        return;
      }
      if (mod || e.altKey) return;
      if (key === 'escape') {
        ref.current.escape?.(e);
        return;
      }
      if (isTyping(e)) return;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    const targets = [window, ...extraTargets.filter((w): w is Window => !!w)];
    for (const t of targets) t.addEventListener('keydown', onKey);
    return () => {
      for (const t of targets) t.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...extraTargets]);
}
