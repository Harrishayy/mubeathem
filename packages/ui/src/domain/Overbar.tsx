import { MOMENT_META, type CallView, type Outcome, type Suggestion } from '@cue/core';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { cx } from '../lib/cx';
import { mascotFor, type Connection } from '../lib/core';
import { Sprout } from '../mascot/Sprout';
import { IconButton } from '../primitives/Button';
import { Drawer } from '../primitives/Drawer';
import { EmptyState, Skeleton } from '../primitives/Feedback';
import { Icon } from '../primitives/Icon';
import { Sheet } from '../primitives/Sheet';
import { Tooltip } from '../primitives/Tooltip';
import { BriefView } from './BriefView';
import { CallTimer } from './CallTimer';
import { ComplianceCard } from './ComplianceCard';
import { ConnectionPill } from './ConnectionPill';
import { useCue } from './CueRoot';
import { FlagsView } from './FlagsView';
import { MomentChip, smartQuotes } from './MomentChip';
import { ProspectHeader } from './ProspectHeader';
import { ReceptivityMeter } from './ReceptivityMeter';
import { SuggestionCard, type OnSuggestionAction, type SuggestionCardHandle } from './SuggestionCard';
import { TranscriptView } from './TranscriptView';
import { UpNextList } from './UpNextList';

export type OverbarMode = 'collapsed' | 'expanded';
export type OverbarPlacement = 'top' | 'inline' | 'sheet';

export interface OverbarProps {
  view: CallView | null;
  connection: Connection;
  mode: OverbarMode;
  onModeChange: (mode: OverbarMode) => void;
  onAction: OnSuggestionAction;
  onEnd?: () => void;
  onOpenSettings?: () => void;
  placement?: OverbarPlacement;
  /** Prospect voice level 0..1, for Sprout's listening ring. */
  voiceLevel?: number;
  /** Which drawers start open. */
  drawers?: { brief?: boolean; transcript?: boolean; flags?: boolean };
  /**
   * Attached to the bar and moves with it (drag included): prompts such as "Start Cue" or a capture
   * warning. Sits under the bar in `top` and `inline`; above the docked bar in `sheet`.
   */
  accessory?: ReactNode;
  /** Handle on the card on screen (use / dismiss / edit / thumbs), for keyboard shortcuts. */
  cardRef?: Ref<SuggestionCardHandle>;
  /** Show provenance details on the card. */
  debug?: boolean;
  /** Print keyboard hints on the card's actions (only where the app binds U / D / E). */
  shortcuts?: boolean;
  /** Clock for the call timer (epoch ms). Pass it when replaying a call faster than real time. */
  now?: number;
  className?: string;
}

const POS_KEY = 'cue.overbar.x';

function readPos(): number {
  try {
    const v = Number(localStorage.getItem(POS_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function writePos(x: number) {
  try {
    localStorage.setItem(POS_KEY, String(Math.round(x)));
  } catch {
    /* storage blocked: position just isn't remembered */
  }
}

/** The line the collapsed bar shows, and how. */
function barLine(view: CallView | null, connection: Connection): { text: string; tone: 'line' | 'quiet' | 'pending' | 'warn' } {
  if (connection === 'offline') return { text: "Offline. Cue will catch up when you're back.", tone: 'quiet' };
  if (!view) return { text: 'Waiting for a call', tone: 'quiet' };
  if (view.status !== 'live') return { text: view.outcome?.outcome === 'meeting_booked' ? 'Meeting booked. Nice work.' : 'Call ended', tone: 'quiet' };
  const c = view.current;
  if (c) return { text: c.kind === 'compliance' ? c.compliance?.rephrase ?? c.say : c.say, tone: c.kind === 'compliance' ? 'warn' : 'line' };
  if (view.pending) return { text: 'Reading the moment…', tone: 'pending' };
  if (view.turns.length === 0) return { text: 'Listening for the prospect', tone: 'quiet' };
  return { text: 'Listening', tone: 'quiet' };
}

/**
 * Cue's overbar. Collapsed it is one pill (≤ 56 px): Sprout, live timer, moment chip, the line on one
 * line with a fade, receptivity, expand. Expanded it is the context.md §4.1 panel. Three placements:
 * `top` floats centred at the top of the viewport and drags left/right; `inline` fills its container
 * (side panel, PiP); `sheet` is the phone layout with a bottom sheet.
 */
export function Overbar(props: OverbarProps) {
  const { view, connection, mode, onModeChange, placement = 'top', voiceLevel = 0, accessory, className } = props;
  const acc = accessory ? <div className="cue-overbar__accessory">{accessory}</div> : null;
  const expanded = mode === 'expanded';
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mascot = mascotFor(view, connection);
  const momentFamily = view?.current ? MOMENT_META[view.current.situation.moment].family : 'neutral';

  // Escape collapses when focus is inside the overbar. Listens on the overbar's own root node, so it
  // also works inside a Shadow DOM (the extension overlay), where window never sees the key and
  // document.activeElement is the shadow host.
  useEffect(() => {
    const el = rootRef.current;
    if (!expanded || !el) return;
    const root = el.getRootNode() as Document | ShadowRoot;
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape' && el.contains(root.activeElement)) onModeChange('collapsed');
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [expanded, onModeChange]);

  const toggle = useCallback(() => onModeChange(expanded ? 'collapsed' : 'expanded'), [expanded, onModeChange]);

  const bar = (
    <Bar
      {...props}
      mascot={mascot}
      expanded={expanded}
      panelId={panelId}
      onToggle={toggle}
      voiceLevel={voiceLevel}
      showLine={!expanded || placement === 'sheet'}
    />
  );

  const body = <ExpandedBody {...props} />;

  if (placement === 'sheet') {
    return (
      <div ref={rootRef} className={cx('cue-overbar', 'cue-overbar--sheet', `cue-fam-${momentFamily}`, className)} data-mode={mode}>
        <div className="cue-overbar__dock">
          {acc}
          {bar}
        </div>
        <Sheet open={expanded} snapPoints={['half', 'full']} onClose={() => onModeChange('collapsed')} title={view?.prospect.name ? `Call with ${view.prospect.name}` : 'Cue'} hideTitle>
          <div id={panelId} className="cue-overbar__sheet-body">
            <Bar {...props} mascot={mascot} expanded panelId={panelId} onToggle={toggle} voiceLevel={voiceLevel} showLine={false} flat />
            {body}
          </div>
        </Sheet>
      </div>
    );
  }

  if (placement === 'inline') {
    return (
      <div ref={rootRef} className={cx('cue-overbar', 'cue-overbar--inline', `cue-fam-${momentFamily}`, className)} data-mode={mode}>
        {bar}
        {acc}
        {expanded && (
          <div id={panelId} className="cue-overbar__panel cue-overbar__panel--inline">
            {body}
          </div>
        )}
      </div>
    );
  }

  return (
    <TopPlacement rootRef={rootRef} className={cx(`cue-fam-${momentFamily}`, className)} mode={mode}>
      {(dragHandle) => (
        <>
          {cloneBarWithHandle(bar, dragHandle)}
          {acc}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="panel"
                id={panelId}
                className="cue-overbar__panel cue-overbar__panel--float"
                initial={{ opacity: 0, y: -8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.985, transition: { duration: 0.14, ease: [0.23, 1, 0.32, 1] } }}
                transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
              >
                {body}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </TopPlacement>
  );
}

function cloneBarWithHandle(bar: ReactNode, handle: (e: React.PointerEvent) => void) {
  return <DragHandleContext.Provider value={handle}>{bar}</DragHandleContext.Provider>;
}

const DragHandleContext = createContext<((e: React.PointerEvent) => void) | null>(null);

/** Fixed, centred, draggable left/right within the viewport; remembers its offset. */
function TopPlacement({ children, rootRef, className, mode }: { children: (h: (e: React.PointerEvent) => void) => ReactNode; rootRef: React.RefObject<HTMLDivElement | null>; className?: string; mode: OverbarMode }) {
  const track = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const [x, setX] = useState(0);
  const { reducedMotion } = useCue();
  useEffect(() => setX(readPos()), []);

  // Keep the remembered offset inside the track when the viewport shrinks.
  useEffect(() => {
    const clamp = () => {
      const t = track.current;
      const el = rootRef.current;
      if (!t || !el) return;
      const room = Math.max(0, (t.clientWidth - el.offsetWidth) / 2);
      setX((v) => Math.max(-room, Math.min(room, v)));
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [rootRef]);

  return (
    <div ref={track} className="cue-overbar-track">
      <motion.div
        ref={rootRef}
        className={cx('cue-overbar', 'cue-overbar--top', className)}
        data-mode={mode}
        drag="x"
        dragControls={controls}
        dragListener={false}
        dragConstraints={track}
        dragElastic={0.04}
        dragMomentum={!reducedMotion}
        dragTransition={{ power: 0.2, timeConstant: 160 }}
        style={{ x }}
        onDragEnd={(_: unknown, info: PanInfo) => {
          const next = x + info.offset.x;
          const t = track.current;
          const el = rootRef.current;
          const room = t && el ? Math.max(0, (t.clientWidth - el.offsetWidth) / 2) : 0;
          const clamped = Math.max(-room, Math.min(room, next));
          setX(clamped);
          writePos(clamped);
        }}
      >
        {children((e) => controls.start(e))}
      </motion.div>
    </div>
  );
}

interface BarProps extends OverbarProps {
  mascot: ReturnType<typeof mascotFor>;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
  showLine: boolean;
  /** Inside the sheet: no pill chrome. */
  flat?: boolean;
}

/** The pill. Also the header row of the expanded panel. */
function Bar({ view, connection, mascot, expanded, panelId, onToggle, voiceLevel, showLine, flat, onEnd, onOpenSettings, placement = 'top', now }: BarProps) {
  const dragHandle = useContext(DragHandleContext);
  const line = barLine(view, connection);
  const current = view?.status === 'live' ? view.current : null;
  const live = view?.status === 'live';
  const situation = view?.situation;

  return (
    <div className={cx('cue-bar', flat && 'cue-bar--flat', expanded && 'is-expanded', `is-${line.tone}`)} data-placement={placement}>
      <span
        className={cx('cue-bar__mascot', dragHandle && 'is-handle')}
        onPointerDown={dragHandle ?? undefined}
        title={dragHandle ? 'Drag to move' : undefined}
      >
        <Sprout state={mascot} size={28} voiceLevel={voiceLevel} />
      </span>

      <span className="cue-bar__status">
        {connection !== 'live' ? (
          <ConnectionPill connection={connection} compact />
        ) : view ? (
          <>
            <span className={cx('cue-bar__live', !live && 'is-ended')}>
              <span className="cue-bar__live-dot" aria-hidden />
              <span className="cue-bar__live-text">{live ? 'Live' : 'Ended'}</span>
            </span>
            <CallTimer startedAt={view.startedAt} endedAt={view.endedAt} now={now} className="cue-bar__timer" />
          </>
        ) : (
          <span className="cue-bar__brand">Cue</span>
        )}
      </span>

      {showLine ? (
        <>
          {current && (
            <span className="cue-bar__moment">
              <MomentChip moment={current.situation.moment} size="sm" fit className="cue-bar__chip" />
              <Tooltip label={smartQuotes(MOMENT_META[current.situation.moment].label)}>
                <span className="cue-bar__chip-icon">
                  <MomentChip moment={current.situation.moment} size="sm" iconOnly />
                </span>
              </Tooltip>
            </span>
          )}
          <div className="cue-bar__line" onClick={onToggle}>
            {/* Keyed by card id so a new card re-mounts with a CSS enter; a refined version of the same card only cross-fades its words. */}
            <p key={current?.id ?? line.text} className="cue-bar__text cue-swap-in" aria-live="polite">
              {line.tone === 'warn' && <Icon name="alert" size={14} className="cue-bar__warn" />}
              <span key={line.text} className="cue-line__words--refined">
                {line.text}
              </span>
            </p>
          </div>
        </>
      ) : (
        <div className="cue-bar__line cue-bar__line--title">
          {view ? (
            <p className="cue-bar__text cue-bar__who">{view.prospect.name || view.prospect.company || 'On a call'}</p>
          ) : (
            <p className="cue-bar__text cue-bar__idle">Waiting for a call</p>
          )}
        </div>
      )}

      {situation && live && showLine && (
        <span className="cue-bar__recept">
          <ReceptivityMeter score={situation.receptivityScore} label={false} />
        </span>
      )}

      <span className="cue-bar__actions">
        {expanded && onOpenSettings && <IconButton icon="settings" label="Settings" size="sm" onClick={onOpenSettings} />}
        {expanded && onEnd && live && <IconButton icon="phone-off" label="End call" size="sm" variant="danger" onClick={onEnd} />}
        {!flat && (
          <IconButton
            icon={expanded ? 'collapse' : 'expand'}
            label={expanded ? 'Collapse' : 'Expand'}
            size="sm"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
            className="cue-bar__toggle"
          />
        )}
        {flat && <IconButton icon="chevron-down" label="Collapse" size="sm" onClick={onToggle} />}
      </span>
    </div>
  );
}

/** The panel under the bar: prospect, the card, up next, drawers. Shared by all placements. */
function ExpandedBody({ view, connection, onAction, drawers, cardRef, debug, shortcuts }: OverbarProps) {
  const [open, setOpen] = useState({ brief: drawers?.brief ?? false, transcript: drawers?.transcript ?? false, flags: drawers?.flags ?? false });
  if (!view) {
    return (
      <div className="cue-panel">
        <EmptyState art={<Sprout state={connection === 'offline' ? 'offline' : 'idle'} size={84} />} title={connection === 'offline' ? "You're offline" : 'Ready when you are'}>
          {connection === 'offline' ? 'Cue reconnects on its own. Typed turns still work.' : 'Start a call in Trellus or from Live, and Cue will show the line to say next.'}
        </EmptyState>
      </div>
    );
  }
  const violations = view.flags.filter((f) => f.verdict === 'violation').length;
  const live = view.status === 'live';
  const interim = view.turns.at(-1)?.final === false ? view.turns.at(-1) : null;
  return (
    <div className="cue-panel">
      <div className="cue-panel__main">
        <ProspectHeader prospect={view.prospect} situation={view.situation} trend={view.receptivityTrend} />
        <div className="cue-panel__stage">
          <CueStage view={view} onAction={onAction} cardRef={cardRef} debug={debug} shortcuts={shortcuts} />
        </div>
        {view.lastError && live && (
          <p className="cue-panel__note" role="status">
            <Icon name="info" size={14} />
            {view.lastError.message}
          </p>
        )}
        {live && view.current && view.current.upNext.length > 0 && <UpNextList items={view.current.upNext} />}
      </div>
      <div className="cue-panel__drawers">
        <Drawer title="Brief" icon="brief" open={open.brief} onOpenChange={(v) => setOpen((o) => ({ ...o, brief: v }))}>
          <BriefView brief={view.brief} loading={!view.brief && live} />
        </Drawer>
        <Drawer
          title="Transcript"
          icon="chat"
          meta={view.turns.length > 0 ? view.turns.length : undefined}
          open={open.transcript}
          onOpenChange={(v) => setOpen((o) => ({ ...o, transcript: v }))}
        >
          <TranscriptView turns={view.turns.filter((t) => t.final)} interim={interim} names={{ prospect: view.prospect.name.split(' ')[0] || 'Prospect' }} maxHeight={280} />
        </Drawer>
        <Drawer
          title="Flags"
          icon="alert"
          meta={<span className={cx('cue-count', violations > 0 && 'is-bad')}>{view.flags.length}</span>}
          open={open.flags}
          onOpenChange={(v) => setOpen((o) => ({ ...o, flags: v }))}
        >
          <FlagsView flags={view.flags} />
        </Drawer>
      </div>
    </div>
  );
}

export interface CueStageProps {
  view: CallView;
  onAction: OnSuggestionAction;
  cardRef?: Ref<SuggestionCardHandle>;
  debug?: boolean;
  shortcuts?: boolean;
  /** `flush` drops the card chrome so it sits edge to edge in a dashboard pane. */
  variant?: 'card' | 'flush';
}

/**
 * The cue on screen: the live suggestion or compliance hold, the "reading the moment" state, the
 * quiet state, or the ended card with its stamp. One at a time; a new one cross-fades in over
 * ~150 ms with a tiny lift (context.md §4.2). Shared by the overbar and the Live dashboard.
 */
export function CueStage({ view, onAction, cardRef, debug, shortcuts, variant = 'card' }: CueStageProps) {
  const live = view.status === 'live';
  const c: Suggestion | null = live ? view.current : null;
  const at = c ? view.history.findIndex((h) => h.suggestion.id === c.id) : -1;
  const cue = c ? (at >= 0 ? at + 1 : view.history.length + 1) : undefined;
  const key = c?.id ?? (live ? (view.pending ? 'pending' : 'quiet') : 'ended');
  return (
    <div key={key} className={cx('cue-stage', 'cue-swap-in', variant === 'flush' && 'cue-stage--flush')}>
        {c ? (
          c.kind === 'compliance' ? (
            <ComplianceCard ref={cardRef} suggestion={c} onAction={onAction} cue={cue} />
          ) : (
            <SuggestionCard ref={cardRef} suggestion={c} onAction={onAction} debug={debug} cue={cue} shortcuts={shortcuts} refining={c.stage === 'instant' && c.servedBy !== 'mubit' && view.pending} />
          )
        ) : !live ? (
          <EndedCard view={view} />
        ) : view.pending ? (
          <div className="cue-card cue-card--hero cue-card--pending cue-fam-neutral" aria-busy="true">
            <div className="cue-card__slug">
              <span className="cue-card__cue">{cueLabelFor(view)}</span>
              <Sprout state="thinking" size={18} decorative />
              <span className="cue-card__who">Reading the moment…</span>
            </div>
            <Skeleton lines={2} height={18} />
            <Skeleton width="45%" height={12} />
          </div>
        ) : (
          <div className="cue-card cue-card--hero cue-card--quiet cue-fam-neutral">
            <p className="cue-quiet">
              <span className="cue-label">Listening</span>
              {view.turns.length === 0 ? 'Listening for the prospect.' : 'Nothing to say right now. Cue will chime in when the prospect finishes.'}
            </p>
          </div>
        )}
    </div>
  );
}

function EndedCard({ view }: { view: CallView }) {
  const booked = view.outcome?.outcome === 'meeting_booked';
  const used = view.history.filter((h) => h.action === 'used' || h.action === 'edited').length;
  const stamp = booked ? 'Booked' : view.outcome ? OUTCOME_STAMP[view.outcome.outcome] : 'Ended';
  return (
    <div className={cx('cue-card', 'cue-card--hero', 'cue-card--ended', booked ? 'cue-fam-signal' : 'cue-fam-neutral')}>
      <div className="cue-ended">
        <Sprout state={booked ? 'celebrating' : view.status === 'reviewing' ? 'learning' : 'idle'} size={56} />
        <div className="cue-ended__text">
          <p className="cue-ended__title">{booked ? 'Meeting booked' : 'Call ended'}</p>
          <p className="cue-ended__meta">
            <span className="cue-num">{view.history.length}</span> {view.history.length === 1 ? 'cue' : 'cues'} · <span className="cue-num">{used}</span> used
            {view.status === 'reviewing' && ' · Cue is learning from this call'}
          </p>
        </div>
        <span className={cx('cue-stamp', booked ? 'is-win' : 'is-plain')} aria-hidden>
          {stamp}
        </span>
      </div>
    </div>
  );
}

const OUTCOME_STAMP: Record<Outcome, string> = { meeting_booked: 'Booked', follow_up: 'Follow-up', callback_requested: 'Callback', not_interested: 'Passed', gatekeeper_blocked: 'Blocked', voicemail: 'Voicemail', no_answer: 'No answer', wrong_person: 'Wrong person', unknown: 'Logged' };

/** The next cue number while the card is still being written. */
function cueLabelFor(view: CallView): string {
  return `Q${String(view.history.length + 1).padStart(2, '0')}`;
}
