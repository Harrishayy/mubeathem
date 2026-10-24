import { Children, isValidElement, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { FoldSideButton, useWorkspace, type WorkspaceSide } from './Workspace';

export interface PaneTab {
  id: string;
  label: string;
  /** A small figure after the label. */
  count?: ReactNode;
}

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
  /**
   * `true` (default): the body scrolls inside the pane (fills a fixed-height cell, e.g. a `Screen`).
   * `false`: the pane grows with its content (report sections on a `Board`).
   * `'cap'`: grows up to about three-quarters of the window, then scrolls inside (long tables).
   */
  scroll?: boolean | 'cap';
  /** Columns on a `Board` (12-column grid). Full width below 1080 px. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  /** Body padding; `none` for tables and lists that rule their own rows. */
  pad?: 'none' | 'sm' | 'md';
  as?: 'section' | 'aside' | 'nav' | 'div';
  className?: string;
  bodyClassName?: string;
  id?: string;
  /**
   * In a `Workspace`: this pane's id, which lets it fold to its head (showing `summary`) and take
   * focus (fill the centre). Fold state is remembered with the workspace.
   */
  paneId?: string;
  /** What the folded head still says ("13 timeouts · slowest 6.2 s"). */
  summary?: ReactNode;
  /** Offer the focus button (centre panes in a workspace). Default true when `paneId` is set. */
  focusable?: boolean;
  /** Offer the fold button. Default true when `paneId` is set. */
  foldable?: boolean;
  /** Share of the centre's height (default 1). */
  grow?: number;
  /** This pane sits in the workspace's rail or drawer: its head gets the button that folds that side. */
  side?: WorkspaceSide;
  /** Views of the same subject as tabs in the head; the body shows the chosen one. */
  tabs?: PaneTab[];
  tab?: string;
  onTab?: (id: string) => void;
}

const UP = 'M6 15l6-6 6 6';
const DOWN = 'M6 9l6 6 6-6';
const GROW = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
const SHRINK = 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7';

function Tool({ d, label, onClick, expanded }: { d: string; label: string; onClick: () => void; expanded?: boolean }) {
  return (
    <button type="button" className="cue-pane__tool" onClick={onClick} aria-label={label} title={label} aria-expanded={expanded}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

/**
 * A dashboard panel: cream body on the olive ground, a pane head in margin capitals, an optional
 * pinned footer for actions. The body scrolls inside the pane so the page never does on a laptop;
 * on phones panes stack and grow. Text inside always wraps: nothing in a pane truncates. In a
 * `Workspace` a pane with a `paneId` folds to its head and can take focus; `tabs` put several views
 * of one subject in one pane so each gets the full width.
 */
export function Pane({
  label,
  meta,
  actions,
  hint,
  footer,
  children,
  scroll = true,
  span,
  pad = 'md',
  as: As = 'section',
  className,
  bodyClassName,
  id,
  paneId,
  summary,
  focusable,
  foldable,
  grow,
  side,
  tabs,
  tab,
  onTab,
}: PaneProps) {
  const ws = useWorkspace();
  const [localFold, setLocalFold] = useState(false);
  const canFold = (foldable ?? !!paneId) && !side;
  const canFocus = !!ws && !!paneId && (focusable ?? true) && !side;
  const folded = canFold && (ws && paneId ? ws.isFolded(paneId) : localFold);
  const focused = !!ws && !!paneId && ws.focus === paneId;
  const toggleFold = () => (ws && paneId ? ws.toggleFold(paneId) : setLocalFold((f) => !f));
  const tabId = (t: string) => `${paneId ?? label.replace(/\W+/g, '-')}-tab-${t}`;
  return (
    <As
      className={cx('cue-pane', scroll === false && 'cue-pane--grow', scroll === 'cap' && 'cue-pane--cap', span && `cue-span-${span}`, folded && 'is-folded', focused && 'is-focused', className)}
      aria-label={label}
      id={id}
      data-pane={paneId}
      style={grow !== undefined ? ({ '--grow': grow } as CSSProperties) : undefined}
    >
      <header className={cx('cue-pane__head', tabs && 'cue-pane__head--tabs')}>
        <span className="cue-label cue-pane__label">{label}</span>
        {tabs && !folded && (
          <span className="cue-pane__tabs" role="tablist" aria-label={`${label} views`}>
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" id={tabId(t.id)} aria-selected={t.id === tab} className={cx('cue-pane__tab', t.id === tab && 'is-on')} onClick={() => onTab?.(t.id)}>
                {t.label}
                {t.count !== undefined && t.count !== null && <span className="cue-pane__tab-count">{t.count}</span>}
              </button>
            ))}
          </span>
        )}
        {meta !== undefined && meta !== null && meta !== false && <span className="cue-pane__meta">{meta}</span>}
        {folded && summary !== undefined && summary !== null && <span className="cue-pane__summary">{summary}</span>}
        {(actions || canFold || canFocus || side) && (
          <span className="cue-pane__actions">
            {!folded && actions}
            {canFocus && <Tool d={focused ? SHRINK : GROW} label={focused ? 'Show all panes' : `Focus ${label.toLowerCase()}`} onClick={() => ws!.setFocus(focused ? null : paneId!)} />}
            {canFold && <Tool d={folded ? DOWN : UP} label={`${folded ? 'Open' : 'Fold'} ${label.toLowerCase()}`} onClick={toggleFold} expanded={!folded} />}
            {side && <FoldSideButton side={side} label={label} />}
          </span>
        )}
      </header>
      {!folded && hint && <p className="cue-hint cue-pane__hint">{hint}</p>}
      {!folded && (
        <div className={cx('cue-pane__body', `cue-pane__body--${pad}`, bodyClassName)} {...(tabs && tab ? { role: 'tabpanel', 'aria-labelledby': tabId(tab) } : {})}>
          {children}
        </div>
      )}
      {!folded && footer && <footer className="cue-pane__foot">{footer}</footer>}
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

/**
 * A row of KPIs that reflows: four across on a laptop, two on a tablet, one on a small phone. In a
 * `Workspace`, `foldId` lets it fold to a one-line ticker of the same figures.
 */
export function KpiStrip({ children, className, foldId }: { children: ReactNode; className?: string; foldId?: string }) {
  const ws = useWorkspace();
  const folded = !!foldId && !!ws?.isFolded(foldId);
  if (foldId && ws?.focus) return null;
  const fold = foldId && ws ? <Tool d={folded ? DOWN : UP} label={folded ? 'Show the numbers' : 'Fold the numbers'} onClick={() => ws.toggleFold(foldId)} expanded={!folded} /> : null;
  if (folded) {
    const items = Children.toArray(children).flatMap((c) => (isValidElement<KpiProps>(c) ? [c.props] : []));
    return (
      <div className={cx('cue-ticker', className)} role="group" aria-label="Headline numbers">
        {items.map((k) => (
          <span key={k.label} className="cue-ticker__item">
            <span className="cue-label">{k.label}</span>
            <span className={cx('cue-ticker__value', k.tone && `is-${k.tone}`)}>{k.value}</span>
          </span>
        ))}
        <span className="cue-ticker__end">{fold}</span>
      </div>
    );
  }
  return (
    <div className={cx('cue-kpis', fold && 'cue-kpis--foldable', className)}>
      {children}
      {fold && <span className="cue-kpis__fold">{fold}</span>}
    </div>
  );
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
