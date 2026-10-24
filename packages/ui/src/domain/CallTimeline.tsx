import { MOMENT_META, type CallView } from '@cue/core';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { useInterval } from '../lib/useInterval';
import { cueLabel } from './SuggestionCard';

export interface CallTimelineProps {
  view: CallView;
  /** Clock (epoch ms); defaults to the call's end or now. */
  now?: number;
  className?: string;
}

const MIN_SPAN = 4 * 60_000;
/** A turn with no known duration is drawn as roughly speaking pace. */
const msFor = (text: string) => Math.min(20_000, Math.max(1200, text.split(/\s+/).length * 380));
const mmss = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/**
 * The call as a strip chart: who spoke when (prospect and rep lanes), each cue as a numbered flag in
 * its moment colour (filled when used, outlined when skipped), and the prospect's mood as a line
 * around neutral. A red rule marks now. The span grows in whole minutes as the call runs, so marks
 * never pile off the end. Every mark has a text equivalent for screen readers.
 */
/** Flag width in px (label + padding + rule) and the gap kept between flags in one row. */
const FLAG_PX = 40;
const ROW_PX = 22;

/** Greedy row packing so flags never overlap at any width: each flag takes the first row it fits. */
export function packRows(xs: number[], width: number): number[] {
  const ends: number[] = [];
  return xs.map((x) => {
    // A flag that would run off the end hangs left from its time instead (see `flip` below).
    const px = Math.min(x * width, Math.max(0, width - FLAG_PX));
    let row = ends.findIndex((end) => px >= end);
    if (row === -1) row = ends.length;
    ends[row] = px + FLAG_PX;
    return row;
  });
}

export function CallTimeline({ view, now, className }: CallTimelineProps) {
  const laneRef = useRef<HTMLOListElement>(null);
  const [, tick] = useState(0);
  useInterval(() => tick((n) => n + 1), now === undefined && view.status === 'live' ? 1000 : null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = laneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(1, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const t = (now ?? view.endedAt ?? Date.now()) - view.startedAt;
  const elapsed = Math.max(0, t);
  const span = Math.max(MIN_SPAN, Math.ceil((elapsed + 30_000) / 60_000) * 60_000);
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / span) * 100)).toFixed(2)}%`;
  const turns = view.turns.filter((x) => x.final);
  const lane = (speaker: 'prospect' | 'rep') =>
    turns
      .filter((x) => x.speaker === speaker)
      .map((x) => ({ id: x.id, left: pct(x.tMs), width: pct(Math.max(span / 400, x.durMs ?? msFor(x.text))) }));
  const minutes = Array.from({ length: span / 60_000 + 1 }, (_, i) => i);
  const cues = view.history.map((h, i) => ({
    id: h.suggestion.id,
    label: cueLabel(i + 1),
    at: Math.max(0, h.suggestion.createdAt - view.startedAt),
    fam: h.suggestion.kind === 'compliance' ? 'compliance' : MOMENT_META[h.suggestion.situation.moment].family,
    state: h.action === 'used' || h.action === 'edited' ? 'used' : h.action === 'dismissed' ? 'skipped' : 'shown',
    moment: MOMENT_META[h.suggestion.situation.moment].label,
  }));
  const rows = packRows(cues.map((c) => c.at / span), width);
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  const mood = view.receptivityTrend.length > 0 ? view.receptivityTrend : [];
  const pts = mood.map((p) => `${((p.tMs / span) * 100).toFixed(2)},${(15 - Math.max(-1, Math.min(1, p.score)) * 12).toFixed(1)}`).join(' ');
  const who = view.prospect.name.split(' ')[0] || 'Prospect';

  return (
    <figure className={cx('cue-tl', className)} aria-label={`Call timeline, ${mmss(elapsed)} so far`}>
      <div className="cue-tl__grid">
        <span />
        <div className="cue-tl__axis" aria-hidden>
          {minutes.map((m) => (
            <span key={m} className="cue-tl__tick" style={{ left: pct(m * 60_000) }}>
              {mmss(m * 60_000)}
            </span>
          ))}
        </div>

        <span className="cue-label cue-tl__name">{who}</span>
        <div className="cue-tl__lane" aria-hidden>
          {lane('prospect').map((b) => (
            <i key={b.id} className="cue-tl__speech is-prospect" style={{ left: b.left, width: b.width }} />
          ))}
          <i className="cue-tl__now" style={{ left: pct(elapsed) }} />
        </div>

        <span className="cue-label cue-tl__name">You</span>
        <div className="cue-tl__lane" aria-hidden>
          {lane('rep').map((b) => (
            <i key={b.id} className="cue-tl__speech is-rep" style={{ left: b.left, width: b.width }} />
          ))}
          <i className="cue-tl__now" style={{ left: pct(elapsed) }} />
        </div>

        <span className="cue-label cue-tl__name">Cues</span>
        <ol ref={laneRef} className="cue-tl__lane cue-tl__lane--cues" style={{ height: rowCount * ROW_PX + 4 }}>
          {cues.map((c, i) => (
            <li key={c.id} className={cx('cue-tl__cue', `cue-fam-${c.fam}`, `is-${c.state}`, (c.at / span) * width + FLAG_PX > width && 'is-flip')} style={{ left: pct(c.at), top: 2 + rows[i]! * ROW_PX }} title={`${c.label} · ${c.moment} · ${c.state}`}>
              <span aria-hidden>{c.label}</span>
              <span className="cue-vh">
                {c.label} at {mmss(c.at)}, {c.moment}, {c.state}
              </span>
            </li>
          ))}
          <li aria-hidden className="cue-tl__now" style={{ left: pct(elapsed) }} />
        </ol>

        <span className="cue-label cue-tl__name">Mood</span>
        <div className="cue-tl__lane cue-tl__lane--mood" aria-hidden>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="cue-tl__svg">
            <line x1="0" y1="15" x2="100" y2="15" className="cue-tl__zero" vectorEffect="non-scaling-stroke" />
            {pts && <polyline points={pts} className="cue-tl__mood" vectorEffect="non-scaling-stroke" />}
          </svg>
          <i className="cue-tl__now" style={{ left: pct(elapsed) }} />
        </div>
      </div>
    </figure>
  );
}
