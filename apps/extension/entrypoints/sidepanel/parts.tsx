import { MOMENT_META, PRODUCT_LABEL, type BriefSource, type CallView, type ResearchHook } from '@cue/core';
import { Icon, ReceptivityMeter, viaLabel } from '@cue/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { request, type BesideMode } from '../../src/messages';
import { domainOf, talkShare, transcriptRows } from '../../src/ui/companion';

/** One titled block of the panel: a margin label, an optional count, then the content. */
export function Section({ id, label, meta, action, children, className }: { id?: string; label: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`sp-sec${className ? ` ${className}` : ''}`} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="sp-sec__head">
        <h2 id={id ? `${id}-h` : undefined} className="cue-label sp-sec__label">
          {label}
        </h2>
        {meta && <span className="sp-sec__meta">{meta}</span>}
        {action && <span className="sp-sec__action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/** Who's on the line, with how open they are and how much of the talking the rep is doing. */
export function Who({ name, role, view, kicker }: { name: string; role: string | null; view?: CallView | null; kicker?: ReactNode }) {
  const share = view ? talkShare(view) : null;
  const situation = view?.situation ?? null;
  return (
    <div className="sp-who">
      <div className="sp-who__id">
        {kicker && <span className="cue-label sp-who__kicker">{kicker}</span>}
        <h1 className="sp-who__name">{name || 'Unknown contact'}</h1>
        {role && <p className="sp-who__role">{role}</p>}
      </div>
      {(situation || share !== null) && (
        <div className="sp-who__read">
          {situation && <ReceptivityMeter score={situation.receptivityScore} trend={view?.receptivityTrend} />}
          {share !== null && (
            <span className="sp-talk" title="Your share of the words said">
              <span className="sp-talk__label">You {Math.round(share * 100)}%</span>
              <span className="sp-talk__bar" aria-hidden>
                <span className="sp-talk__fill" style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Opens a page beside the call (split view, else a window beside it). One research tab per call. */
export function useBeside() {
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<BesideMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = async (url: string) => {
    setError(null);
    const res = await request<{ mode: BesideMode }>({ type: 'beside.open', url });
    if (res.ok) {
      setOpen(url);
      setMode(res.data.mode);
    } else setError(res.error);
  };
  const close = async () => {
    await request({ type: 'beside.close' });
    setOpen(null);
    setMode(null);
  };
  return { open, mode, error, show, close };
}

export type BesideApi = ReturnType<typeof useBeside>;

function BesideButton({ url, beside, label }: { url: string; beside: BesideApi; label: string }) {
  const on = beside.open === url;
  return (
    <button type="button" className="sp-beside" aria-pressed={on} onClick={() => void beside.show(url)} title={on ? 'Showing beside the call' : 'Open beside the call'}>
      <Icon name="arrow-up-right" size={14} />
      <span className="cue-vh">{on ? `${label}, showing beside the call` : `Open ${label} beside the call`}</span>
    </button>
  );
}

/** The reasons to call now, each tagged with the cover it points to and where it came from. */
export function HookList({ hooks, beside, limit }: { hooks: ResearchHook[]; beside: BesideApi; limit?: number }) {
  const shown = limit ? hooks.slice(0, limit) : hooks;
  if (!shown.length) return <p className="sp-quiet">No findings yet. The brief uses the CRM record.</p>;
  return (
    <ul className="sp-hooks">
      {shown.map((h, i) => {
        const where = domainOf(h.url) ?? (h.via === 'crm' ? 'from HubSpot' : viaLabel(h.via));
        return (
          <li key={i} className="sp-hook">
            <span className="sp-tag">{PRODUCT_LABEL[h.product] ?? h.product}</span>
            <span className="sp-hook__text">
              {h.hook}
              {where && <span className="sp-hook__src"> · {where}</span>}
            </span>
            {h.url && <BesideButton url={h.url} beside={beside} label={where ?? 'the source'} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Every page the research read, newest first, each one click from opening beside the call. */
export function SourceList({ sources, beside }: { sources: BriefSource[]; beside: BesideApi }) {
  const web = sources.filter((s) => s.url);
  if (!web.length) return <p className="sp-quiet">Nothing from the web for this one: the brief is from the CRM record.</p>;
  return (
    <ul className="sp-sources">
      {web.map((s, i) => {
        const on = beside.open === s.url;
        return (
          <li key={i}>
            <button type="button" className="sp-source" aria-pressed={on} onClick={() => void beside.show(s.url!)}>
              <Icon name="arrow-up-right" size={14} />
              <span className="sp-source__title">{s.title}</span>
              <span className="sp-source__meta">
                {domainOf(s.url)}
                {s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ''}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Showing beside the call" with a way to close it, after a source was opened. */
export function BesideNote({ beside }: { beside: BesideApi }) {
  if (beside.error) return <p className="sp-inline-note sp-inline-note--warn" role="alert">{beside.error}</p>;
  if (!beside.open) return null;
  const where = beside.mode === 'split' ? 'in split view' : beside.mode === 'window' ? 'in a window beside this one' : 'in the next tab';
  return (
    <p className="sp-inline-note" role="status">
      <span>
        Showing {domainOf(beside.open)} {where}.
      </span>
      <button type="button" className="sp-textbtn" onClick={() => void beside.close()}>
        Close it
      </button>
    </p>
  );
}

/**
 * The transcript, live: who said what, the moment Cue read above each prospect turn it answered, a
 * tick under the rep's turn when they used Cue's line, and the latest prospect turn picked out.
 * Follows the newest turn unless the rep has scrolled up.
 */
export function Transcript({ view, first }: { view: CallView; first: string }) {
  const rows = transcriptRows(view);
  const box = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [rows.length, view.turns.at(-1)?.text, follow]);
  if (!rows.length) return <p className="sp-quiet sp-transcript__empty">Nothing said yet. What Cue hears shows up here.</p>;
  return (
    <ol
      ref={box}
      className="sp-transcript"
      aria-label="Transcript"
      aria-live="polite"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
    >
      {rows.map((r) =>
        r.kind === 'moment' ? (
          <li key={r.key} className={`sp-moment cue-fam-${r.family}`} aria-label={`Moment: ${MOMENT_META[r.moment].label}`}>
            <span className="sp-moment__key" aria-hidden />
            <span className="sp-moment__label">{MOMENT_META[r.moment].short}</span>
            <span className="sp-moment__rule" aria-hidden />
          </li>
        ) : (
          <li key={r.key} className={`sp-turn sp-turn--${r.turn.speaker}${r.latest ? ' is-latest' : ''}`}>
            <span className="cue-label sp-turn__who">{r.turn.speaker === 'rep' ? 'You' : first}</span>
            <span className="sp-turn__text">
              {r.turn.text}
              {!r.turn.final && (
                <span className="sp-speaking">
                  <span className="sp-speaking__dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  still speaking
                </span>
              )}
              {r.usedLine && (
                <span className="sp-used">
                  <Icon name="check" size={12} /> Cue line
                </span>
              )}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

export const firstName = (name: string) => name.split(/\s+/)[0] || name || 'Them';
