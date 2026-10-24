import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export type WorkspaceSide = 'rail' | 'drawer';

interface WorkspaceState {
  rail: boolean;
  drawer: boolean;
  folded: string[];
}

export interface WorkspaceApi {
  /** Is this side open (true) or folded to its strip (false)? */
  sideOpen(side: WorkspaceSide): boolean;
  toggleSide(side: WorkspaceSide, open?: boolean): void;
  isFolded(paneId: string): boolean;
  toggleFold(paneId: string): void;
  /** The pane filling the centre, or null. */
  focus: string | null;
  setFocus(paneId: string | null): void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

/** The surrounding workspace's fold and focus state, or null outside one. */
export function useWorkspace(): WorkspaceApi | null {
  return useContext(Ctx);
}

function load(key: string | undefined, fallback: WorkspaceState): WorkspaceState {
  if (!key) return fallback;
  try {
    const raw = window.localStorage.getItem(`cue.ws.${key}`);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<WorkspaceState>;
    return { rail: v.rail ?? fallback.rail, drawer: v.drawer ?? fallback.drawer, folded: Array.isArray(v.folded) ? v.folded.filter((x) => typeof x === 'string') : fallback.folded };
  } catch {
    return fallback;
  }
}

export interface WorkspaceSideProps {
  /** Name on the folded strip and in the toggle's accessible name ("Filters"). */
  label: string;
  /** A few words on the folded strip so it still says something ("3 on", "1 failed"). */
  summary?: ReactNode;
  /** A small figure at the top of the folded strip (a count). */
  count?: ReactNode;
  /** One or more panes. They share the column's height. */
  children: ReactNode;
  /** Column width when open. Default rail `minmax(200px, 15vw)`, drawer `minmax(340px, 27vw)`. */
  width?: string;
  defaultOpen?: boolean;
}

export interface WorkspaceProps {
  /** Left column: filters, an index, a list of people. Folds to a strip. */
  rail?: WorkspaceSideProps;
  /** Right column: the detail of what's selected. Folds to a strip. */
  drawer?: WorkspaceSideProps;
  /** The centre: KPIs and panes, stacked; each pane takes a share of the height (`grow`). */
  children: ReactNode;
  /** Remembers what's folded on this screen (browser storage, per screen). */
  storageKey?: string;
  className?: string;
  /** Centre layout: `stack` (default) panes stacked; `row` panes side by side. */
  centre?: 'stack' | 'row';
}

const FOLD_ICON = { rail: 'M15 6l-6 6 6 6', drawer: 'M9 6l6 6-6 6' };
const OPEN_ICON = { rail: 'M9 6l6 6-6 6', drawer: 'M15 6l-6 6 6 6' };

/**
 * The page layout for every screen: a left rail, the centre, and a right drawer, filling the window
 * under the band (1vw × the rest of the height). The rail and drawer fold to labelled strips; panes in
 * the centre fold to their head (keeping a summary) or take focus and fill the centre. `[` folds the
 * rail, `]` the drawer, Esc leaves focus. Below 1080 px everything stacks and the page scrolls.
 */
export function Workspace({ rail, drawer, children, storageKey, className, centre = 'stack' }: WorkspaceProps) {
  const [st, setSt] = useState<WorkspaceState>(() => load(storageKey, { rail: rail?.defaultOpen ?? true, drawer: drawer?.defaultOpen ?? true, folded: [] }));
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(`cue.ws.${storageKey}`, JSON.stringify(st));
    } catch {
      // private mode or blocked storage: folds just aren't remembered
    }
  }, [st, storageKey]);

  const toggleSide = useCallback((side: WorkspaceSide, open?: boolean) => setSt((s) => ({ ...s, [side]: open ?? !s[side] })), []);
  const toggleFold = useCallback((id: string) => {
    setFocus(null);
    setSt((s) => ({ ...s, folded: s.folded.includes(id) ? s.folded.filter((x) => x !== id) : [...s.folded, id] }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t?.closest('dialog[open]')) return;
      if (e.key === '[' && rail) toggleSide('rail');
      else if (e.key === ']' && drawer) toggleSide('drawer');
      else if (e.key === 'Escape' && focus) setFocus(null);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rail, drawer, focus, toggleSide]);

  const api = useMemo<WorkspaceApi>(
    () => ({ sideOpen: (side) => st[side], toggleSide, isFolded: (id) => st.folded.includes(id) && focus !== id, toggleFold, focus, setFocus }),
    [st, toggleSide, toggleFold, focus],
  );

  const col = (side: WorkspaceSide, p: WorkspaceSideProps | undefined) => (!p ? null : st[side] ? (p.width ?? (side === 'rail' ? 'minmax(200px, 15vw)' : 'minmax(340px, 27vw)')) : '44px');
  const cols = [col('rail', rail), 'minmax(0, 1fr)', col('drawer', drawer)].filter(Boolean).join(' ');

  const side = (s: WorkspaceSide, p: WorkspaceSideProps | undefined) => {
    if (!p) return null;
    if (!st[s]) {
      return (
        <button type="button" className={cx('cue-ws__strip', `cue-ws__strip--${s}`)} onClick={() => toggleSide(s, true)} aria-label={`Show ${p.label.toLowerCase()}`} aria-expanded={false} title={`Show ${p.label.toLowerCase()} (${s === 'rail' ? '[' : ']'})`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={OPEN_ICON[s]} />
          </svg>
          {p.count !== undefined && <span className="cue-ws__strip-count">{p.count}</span>}
          <span className="cue-ws__strip-label">
            {p.label}
            {p.summary ? <> · {p.summary}</> : null}
          </span>
        </button>
      );
    }
    return (
      <div className={cx('cue-ws__side', `cue-ws__side--${s}`)} data-side={s}>
        {p.children}
      </div>
    );
  };

  return (
    <Ctx.Provider value={api}>
      <div className={cx('cue-ws', className)} style={{ '--ws-cols': cols } as CSSProperties} data-focus={focus ?? undefined}>
        {side('rail', rail)}
        <div className={cx('cue-ws__centre', centre === 'row' && 'cue-ws__centre--row')}>{children}</div>
        {side('drawer', drawer)}
      </div>
    </Ctx.Provider>
  );
}

/** A pane-head button that folds the rail or drawer it sits in. */
export function FoldSideButton({ side, label }: { side: WorkspaceSide; label: string }) {
  const ws = useWorkspace();
  if (!ws) return null;
  return (
    <button type="button" className="cue-pane__tool" onClick={() => ws.toggleSide(side, false)} aria-label={`Fold ${label.toLowerCase()}`} title={`Fold ${label.toLowerCase()} (${side === 'rail' ? '[' : ']'})`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={FOLD_ICON[side]} />
      </svg>
    </button>
  );
}
