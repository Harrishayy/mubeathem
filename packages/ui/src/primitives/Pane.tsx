import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PaneProps {
  /** Margin-capitals name in the pane head ("Transcript"). Also the accessible name. */
  label: string;
  /** Small figures or words beside the label (a count, a session id). */
  meta?: ReactNode;
  /** Right side of the head: filters, a status tag, a segmented control. Wraps under on narrow panes. */
  actions?: ReactNode;
  /** One plain-language line under the head: what this pane shows and why it matters. */
  hint?: ReactNode;
  /** A ruled action bar pinned to the bottom of the pane. */
  footer?: ReactNode;
  children: ReactNode;
  /** The body scrolls inside the pane (default). Off: the pane grows with its content. */
  scroll?: boolean;
  /** Body padding; `none` for tables and lists that rule their own rows. */
  pad?: 'none' | 'sm' | 'md';
  as?: 'section' | 'aside' | 'nav' | 'div';
  className?: string;
  bodyClassName?: string;
  id?: string;
}

/**
 * A dashboard panel: cream body on the olive ground, a pane head in margin capitals, an optional
 * pinned footer for actions. The body scrolls inside the pane so the page never does on a laptop;
 * on phones panes stack and grow. Text inside always wraps: nothing in a pane truncates.
 */
export function Pane({ label, meta, actions, hint, footer, children, scroll = true, pad = 'md', as: As = 'section', className, bodyClassName, id }: PaneProps) {
  return (
    <As className={cx('cue-pane', !scroll && 'cue-pane--grow', className)} aria-label={label} id={id}>
      <header className="cue-pane__head">
        <span className="cue-label cue-pane__label">{label}</span>
        {meta !== undefined && meta !== null && meta !== false && <span className="cue-pane__meta">{meta}</span>}
        {actions && <span className="cue-pane__actions">{actions}</span>}
      </header>
      {hint && <p className="cue-hint cue-pane__hint">{hint}</p>}
      <div className={cx('cue-pane__body', `cue-pane__body--${pad}`, bodyClassName)}>{children}</div>
      {footer && <footer className="cue-pane__foot">{footer}</footer>}
    </As>
  );
}

/** A sub-head inside a pane body: a ruled band with a label, meta and actions. */
export function PaneSection({ label, meta, actions, hint, children, className }: { label: string; meta?: ReactNode; actions?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('cue-pane-sec', className)} aria-label={label}>
      <header className="cue-pane-sec__head">
        <span className="cue-label">{label}</span>
        {meta !== undefined && meta !== null && <span className="cue-pane__meta">{meta}</span>}
        {actions && <span className="cue-pane__actions">{actions}</span>}
      </header>
      <div className="cue-pane-sec__body">
        {hint && <p className="cue-hint cue-pane-sec__hint">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

/**
 * A muted one-liner that explains what something means, in plain words. Panes and sections take it
 * as `hint`; use this directly under a heading or a control. `term` names the technical word, kept
 * secondary ("Moment read · read_moment").
 */
export function Hint({ children, term, className }: { children: ReactNode; term?: ReactNode; className?: string }) {
  return (
    <p className={cx('cue-hint', className)}>
      {children}
      {term && (
        <>
          {' '}
          <span className="cue-hint__term">{term}</span>
        </>
      )}
    </p>
  );
}

export interface KpiProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
  className?: string;
}

/** A headline figure: label, a big mono number, one line of context. */
export function Kpi({ label, value, note, tone = 'neutral', className }: KpiProps) {
  return (
    <div className={cx('cue-kpi', `cue-kpi--${tone}`, className)}>
      <span className="cue-label">{label}</span>
      <span className="cue-kpi__value">{value}</span>
      {note && <span className="cue-kpi__note">{note}</span>}
    </div>
  );
}

/** A row of KPIs that reflows: four across on a laptop, two on a tablet, one on a small phone. */
export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('cue-kpis', className)}>{children}</div>;
}

export interface KeyValueItem {
  label: string;
  value: ReactNode;
}

/** A definition list in two columns (label in margin capitals, value wraps). Stacks on narrow panes. */
export function KeyValue({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cx('cue-kv', className)}>
      {items.map((it) => (
        <div key={it.label} className="cue-kv__row">
          <dt className="cue-label">{it.label}</dt>
          <dd className="cue-kv__value">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A grid of stat cells with shared rules (the scorecard look). */
export function StatGrid({ items, columns = 2, className }: { items: { label: string; value: ReactNode; note?: ReactNode }[]; columns?: 2 | 3 | 5 | 'auto'; className?: string }) {
  return (
    <div className={cx('cue-stats', `cue-stats--${columns}`, className)}>
      {items.map((s) => (
        <div key={s.label} className="cue-stat">
          <span className="cue-label">{s.label}</span>
          <span className="cue-stat__value">{s.value}</span>
          {s.note && <span className="cue-stat__note">{s.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** A bottom action bar: primary actions on the start side, quiet ones pushed to the end. */
export function ActionBar({ children, end, className }: { children?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cx('cue-actionbar', className)}>
      {children}
      {end && <span className="cue-actionbar__end">{end}</span>}
    </div>
  );
}

/** A horizontal proportion bar with its figure (win rate, progress). `mark` draws a threshold tick. */
export function Bar({ value, label, mark, tone = 'moment', className }: { value: number; label?: ReactNode; mark?: number; tone?: 'moment' | 'ok' | 'accent' | 'ink'; className?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className={cx('cue-bar-h', `cue-bar-h--${tone}`, className)}>
      <span className="cue-bar-h__track" aria-hidden>
        <span className="cue-bar-h__fill" style={{ transform: `scaleX(${v.toFixed(4)})` }} />
        {mark !== undefined && <span className="cue-bar-h__mark" style={{ left: `${(Math.max(0, Math.min(1, mark)) * 100).toFixed(1)}%` }} />}
      </span>
      {label !== undefined && <span className="cue-bar-h__label">{label}</span>}
    </span>
  );
}
