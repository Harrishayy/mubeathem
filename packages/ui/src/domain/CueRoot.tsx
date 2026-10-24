import { MotionConfig } from 'motion/react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export type Direction = 'honey' | 'night' | 'signal';
export type ThemePref = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
/** Gallery/testing override; 'system' follows prefers-reduced-motion. */
export type MotionPref = 'system' | 'reduce' | 'full';

export interface CueRootProps {
  direction?: Direction;
  theme?: ThemePref;
  density?: Density;
  /** Optional: force reduced (or full) motion regardless of the OS setting. */
  motion?: MotionPref;
  className?: string;
  children?: ReactNode;
}

interface CueContextValue {
  direction: Direction;
  theme: 'light' | 'dark';
  density: Density;
  reducedMotion: boolean;
  /** Fixed, full-viewport layer inside the root for tooltips and toasts (escapes overflow clipping). */
  layer: HTMLElement | null;
}

const CueContext = createContext<CueContextValue>({ direction: 'honey', theme: 'light', density: 'comfortable', reducedMotion: false, layer: null });

/** Direction, resolved theme, density, reduced motion and the overlay layer of the nearest CueRoot. */
export function useCue(): CueContextValue {
  return useContext(CueContext);
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * The root every Cue surface renders inside: sets data-dir / data-theme / data-density for the
 * tokens, resolves `theme="system"`, and configures motion to honour reduced motion. Night Shift is
 * always dark. Works the same on a page, in a side panel and inside a Shadow DOM.
 */
export function CueRoot({ direction = 'honey', theme = 'system', density = 'comfortable', motion = 'system', className, children }: CueRootProps) {
  const prefersDark = useMedia('(prefers-color-scheme: dark)');
  const prefersReduced = useMedia('(prefers-reduced-motion: reduce)');
  const resolved: 'light' | 'dark' = direction === 'night' ? 'dark' : theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const reducedMotion = motion === 'reduce' || (motion === 'system' && prefersReduced);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <CueContext.Provider value={{ direction, theme: resolved, density, reducedMotion, layer }}>
      <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
        <div
          data-cue=""
          data-dir={direction}
          data-theme={resolved}
          data-density={density}
          data-motion={motion === 'system' ? undefined : motion}
          data-mounted={mounted || undefined}
          className={cx('cue-root', className)}
        >
          {children}
          <div ref={setLayer} className="cue-layer" />
        </div>
      </MotionConfig>
    </CueContext.Provider>
  );
}
