import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface AppTab {
  id: string;
  label: string;
  href: string;
  /** A small figure after the label (42, 6/6). */
  count?: ReactNode;
  /** A live dot (a call is on). */
  live?: boolean;
}

export interface AppBarProps {
  tabs: AppTab[];
  active: string;
  /** Right side: status tags, the call tally, primary actions. Wraps under the tabs on phones. */
  end?: ReactNode;
  /** Brand slot (defaults to the CUE wordmark). */
  brand?: ReactNode;
  onNavigate?: (tab: AppTab, e: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}

/** The sprout mark used in the band. Decorative. */
export function CueMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="cue-mark">
      <path d="M12 21V11" stroke="var(--sprout-leaf-2)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 12C12 7 8 5 4 5c0 4 3 7 8 7Z" fill="var(--sprout-leaf-2)" />
      <path d="M12 10c0-4 3-6 7-6 0 4-3 6-7 6Z" fill="var(--sprout-vein)" />
      <path d="M6 15h12l-1.5 6h-9Z" fill="var(--sprout-pod)" />
    </svg>
  );
}

/**
 * The deep-olive band across the top of every dashboard: wordmark, folder tabs that join the page
 * below, and a status/actions slot. Tabs scroll sideways on a phone rather than wrapping or clipping.
 */
export function AppBar({ tabs, active, end, brand, onNavigate, className }: AppBarProps) {
  return (
    <header className={cx('cue-appbar', className)}>
      <div className="cue-appbar__brand">
        {brand ?? (
          <>
            <CueMark />
            <span className="cue-appbar__word">Cue</span>
          </>
        )}
      </div>
      <nav className="cue-appbar__tabs" aria-label="Sections">
        {tabs.map((t) => (
          <a key={t.id} href={t.href} className={cx('cue-appbar__tab', t.id === active && 'is-active')} aria-current={t.id === active ? 'page' : undefined} onClick={onNavigate ? (e) => onNavigate(t, e) : undefined}>
            {t.label}
            {t.live && <span className="cue-appbar__live" aria-label="call in progress" />}
            {t.count !== undefined && <span className="cue-appbar__count">{t.count}</span>}
          </a>
        ))}
      </nav>
      {end && <div className="cue-appbar__end">{end}</div>}
    </header>
  );
}

/** A status tag that reads on the dark band. */
export function BandTag({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'plain' }) {
  return <span className={cx('cue-bandtag', `cue-bandtag--${tone}`)}>{children}</span>;
}
