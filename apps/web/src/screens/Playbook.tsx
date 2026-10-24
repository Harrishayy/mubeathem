import { MOMENT_META, type LineStats, type PlaybookLine, type PlaybookResponse } from '@cue/core';
import { Chip, EmptyState, ErrorState, MomentChip, PlaybookBoard, Skeleton, Sprout } from '@cue/ui';
import { useEffect, useRef, useState } from 'react';
import { useResource } from '../hooks/useResource';
import { getApi } from '../state/api';
import { useStore } from '../state/store';
import { toast, uiStore } from '../state/ui';

const ZERO: LineStats = { shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 };
const total = (l: PlaybookLine): LineStats => l.stats['*'] ?? ZERO;

export interface LineChange {
  line: PlaybookLine;
  delta: LineStats;
  added: boolean;
  /** `delta` holds running totals rather than a change. */
  totals?: boolean;
}

/** Lines whose totals moved between two playbook snapshots (what the last review changed). */
export function diffPlaybook(before: PlaybookResponse | null, after: PlaybookResponse): LineChange[] {
  if (!before) return [];
  const prev = new Map(before.lines.map((l) => [l.id, l]));
  const out: LineChange[] = [];
  for (const l of after.lines) {
    const p = prev.get(l.id);
    const a = total(l);
    const b = p ? total(p) : ZERO;
    const delta: LineStats = { shown: a.shown - b.shown, used: a.used - b.used, stepWins: a.stepWins - b.stepWins, booked: a.booked - b.booked, lost: a.lost - b.lost };
    const moved = Object.values(delta).some((d) => d !== 0);
    if (!p || moved) out.push({ line: l, delta, added: !p });
  }
  return out;
}

function deltaText(d: LineStats): string {
  const parts: string[] = [];
  if (d.booked) parts.push(`+${d.booked} booked`);
  if (d.stepWins) parts.push(`+${d.stepWins} step won`);
  if (d.used) parts.push(`+${d.used} used`);
  if (d.shown && !d.used) parts.push(`+${d.shown} shown`);
  if (d.lost) parts.push(`+${d.lost} lost`);
  return parts.join(' · ') || 'updated';
}

/** The team playbook: ranked lines per moment, candidates to approve, and what just changed. */
export function Playbook() {
  const res = useResource((signal) => getApi().playbook({ signal }), [], 4_000);
  const prev = useRef<PlaybookResponse | null>(null);
  const [changes, setChanges] = useState<LineChange[]>([]);
  const highlight = useStore(uiStore, (u) => u.highlightLines);

  useEffect(() => {
    if (!res.data) return;
    const c = diffPlaybook(prev.current, res.data);
    if (c.length) setChanges(c);
    else if (!prev.current && highlight.length) {
      // Opened right after a review: show the lines it touched with their running totals.
      const ids = new Set(highlight);
      setChanges(res.data.lines.filter((l) => ids.has(l.id)).map((l) => ({ line: l, delta: total(l), added: l.status === 'candidate', totals: true })));
    }
    prev.current = res.data;
  }, [res.data]);

  const decide = async (id: string, verdict: 'approve' | 'reject') => {
    try {
      await (verdict === 'approve' ? getApi().approveLine(id) : getApi().rejectLine(id));
      res.reload();
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not save that', description: e instanceof Error ? e.message : String(e) });
    }
  };

  const d = res.data;
  const active = d?.lines.filter((l) => l.status === 'active').length ?? 0;
  const candidates = d?.lines.filter((l) => l.status === 'candidate').length ?? 0;

  return (
    <div className="web-screen web-page">
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">Playbook</p>
          <h1 className="web-h1">What books meetings</h1>
          <p className="web-muted">Every line, ranked per moment by the calls it booked. New lines from calls wait here for a manager's yes.</p>
        </div>
        {d && (
          <div className="web-row">
            <Chip tone="ok" icon="check">
              {active} active
            </Chip>
            <Chip tone="accent" icon="spark">
              {candidates} waiting
            </Chip>
          </div>
        )}
      </header>

      {changes.length > 0 && (
        <section className="web-panel web-learned" aria-live="polite" aria-labelledby="learned-title">
          <div className="web-learned__art">
            <Sprout state="learning" size={56} growth={0.6} />
          </div>
          <div className="web-learned__body">
            <h2 className="web-h3" id="learned-title">
              Just learned
            </h2>
            <ul className="web-learned__list">
              {changes.slice(0, 6).map((c) => (
                <li key={c.line.id} className={`web-learned__item cue-fam-${MOMENT_META[c.line.moment].family}`}>
                  <MomentChip moment={c.line.moment} size="sm" />
                  <span className="web-learned__line">{c.line.text}</span>
                  <Chip size="sm" tone={c.added ? 'accent' : c.delta.booked > 0 ? 'ok' : 'neutral'}>
                    {c.added ? 'New candidate' : c.totals ? `${c.delta.booked} booked · ${c.delta.used} used` : deltaText(c.delta)}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {res.error && !d ? (
        <ErrorState title="Can't load the playbook" message={res.error.message} onRetry={res.reload} />
      ) : !d ? (
        <div className="web-panel web-stack" aria-busy="true">
          <Skeleton width="30%" height={20} />
          <Skeleton lines={4} />
        </div>
      ) : d.lines.length === 0 ? (
        <EmptyState art={<Sprout state="idle" size={84} />} title="No lines yet">
          The playbook fills in as calls are reviewed.
        </EmptyState>
      ) : (
        <PlaybookBoard data={d} highlightIds={changes.length ? changes.map((c) => c.line.id) : highlight} onApprove={(id) => void decide(id, 'approve')} onReject={(id) => void decide(id, 'reject')} />
      )}
    </div>
  );
}
