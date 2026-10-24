import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useChromeHeight } from '../lib/useChromeHeight';

/**
 * The page layout for every dashboard screen except the live console. The page scrolls; the band
 * and the screen's toolbar stay pinned. Content is a 12-column board of full-width rows:
 *
 * - `BoardSection` — a titled row; children are panes with a `span` class (`cue-span-4/6/8/12`).
 *   Panes here take their content's height, so a table shows its rows instead of two of them.
 * - `Screen` — a list + detail that fills the window below the pinned chrome: the list scrolls
 *   inside itself and the detail stays beside it. Never stack two scrolling panes vertically.
 *
 * Below 1080 px every span becomes full width and screens grow with their content.
 */
export function Board({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('cue-board', className)}>{children}</div>;
}

export interface BoardSectionProps {
  /** Section title (h2). Also the jump target for `SectionNav`. */
  title?: string;
  /** Anchor id for `SectionNav`. */
  id?: string;
  /** One plain-language line under the title. */
  hint?: ReactNode;
  /** Right side of the section head (a filter, a link). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BoardSection({ title, id, hint, actions, children, className }: BoardSectionProps) {
  return (
    <section className={cx('cue-board__section', className)} id={id} aria-label={title}>
      {(title || actions) && (
        <header className="cue-board__head">
          {title && <h2 className="cue-board__title">{title}</h2>}
          {hint && <p className="cue-board__hint">{hint}</p>}
          {actions && <div className="cue-board__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A list beside its detail, filling the window under the pinned band and toolbar. `cols` is a
 * grid-template-columns value (default: list, then a detail column of about a third).
 */
export function Screen({ children, cols, className }: { children: ReactNode; cols?: string; className?: string }) {
  return (
    <div className={cx('cue-screen', className)} style={cols ? ({ '--screen-cols': cols } as CSSProperties) : undefined}>
      {children}
    </div>
  );
}

/** The screen's filters and section links, pinned under the band while the page scrolls. */
export function Toolbar({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useChromeHeight(ref, '--toolbar-h');
  return (
    <div ref={ref} className={cx('cue-toolbar', className)} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export interface SectionLink {
  id: string;
  label: string;
}

/** Jump links to the board's sections, for long report pages. Scrolls below the pinned chrome. */
export function SectionNav({ links, label = 'On this page' }: { links: SectionLink[]; label?: string }) {
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const focusable = el.querySelector<HTMLElement>('h2, [tabindex]');
    if (focusable) {
      if (!focusable.hasAttribute('tabindex')) focusable.setAttribute('tabindex', '-1');
      focusable.focus({ preventScroll: true });
    }
  };
  return (
    <nav className="cue-sectionnav" aria-label={label}>
      {links.map((l) => (
        <button key={l.id} type="button" className="cue-sectionnav__link" onClick={() => go(l.id)}>
          {l.label}
        </button>
      ))}
    </nav>
  );
}
