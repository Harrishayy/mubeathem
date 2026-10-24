import { MOMENTS, MOMENT_META, PERSONA_LABEL, type LineStats, type Moment, type Persona, type PlaybookLine, type PlaybookResponse } from '@cue/core';
import {
  ActionBar,
  Bar,
  Button,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  MomentChip,
  Pane,
  PaneSection,
  Skeleton,
  Sprout,
  StatGrid,
  momentParts,
  type ChipTone,
  type Column,
} from '@cue/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  if (d.stepWins) parts.push(`+${d.stepWins} moved forward`);
  if (d.used) parts.push(`+${d.used} used`);
  if (d.shown && !d.used) parts.push(`+${d.shown} shown`);
  if (d.lost) parts.push(`+${d.lost} lost`);
  return parts.join(' · ') || 'updated';
}

type PersonaFilter = 'all' | Persona;
const PERSONA_FILTERS: PersonaFilter[] = ['all', 'gatekeeper', 'ceo', 'cfo', 'engineer'];

function add(a: LineStats, b: LineStats): LineStats {
  return { shown: a.shown + b.shown, used: a.used + b.used, stepWins: a.stepWins + b.stepWins, booked: a.booked + b.booked, lost: a.lost + b.lost };
}

/** Stats for one persona (summed over its situation keys), or the line's totals. */
function statsFor(l: PlaybookLine, persona: PersonaFilter): LineStats {
  if (persona === 'all') return total(l);
  let s = ZERO;
  for (const [k, v] of Object.entries(l.stats)) if (k !== '*' && k.split('.')[0] === persona) s = add(s, v);
  return s;
}

/** Step wins per use: the moment's own win rule. Null until the line has been used. */
const winRate = (s: LineStats): number | null => (s.used > 0 ? Math.min(1, s.stepWins / s.used) : null);
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

function policyTag(l: PlaybookLine): { label: string; tone: ChipTone } | null {
  if (!l.policy) return null;
  if (l.policy.verdict === 'violation') return { label: 'Breaks policy', tone: 'bad' };
  if (l.policy.verdict === 'supported') return { label: 'Policy OK', tone: 'ok' };
  return { label: 'Needs a check', tone: 'warn' };
}

const ORIGIN: Record<PlaybookLine['origin'], string> = { seed: 'Seeded with the playbook', rep: 'Written by a rep', manager: 'Added by a manager', model: 'Proposed by the model' };
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

interface Ranked {
  line: PlaybookLine;
  stats: LineStats;
  rate: number | null;
  trial: boolean;
}

/** The team playbook: moments, ranked lines per moment, one line in detail, candidates to approve. */
export function Playbook() {
  const res = useResource((signal) => getApi().playbook({ signal }), [], 4_000);
  const prev = useRef<PlaybookResponse | null>(null);
  const [changes, setChanges] = useState<LineChange[]>([]);
  const highlight = useStore(uiStore, (u) => u.highlightLines);
  const [moment, setMoment] = useState<Moment | 'all'>('all');
  const [persona, setPersona] = useState<PersonaFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Record<string, 'approve' | 'reject'>>({});
  // Panes stack on phones and tablets: bring the detail into view when a line is picked there.
  const pick = (id: string) => {
    setSelected(id);
    if (window.matchMedia('(max-width: 1079.98px)').matches) requestAnimationFrame(() => document.getElementById('pb-line-detail')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };

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
    setDeciding((d) => ({ ...d, [id]: verdict }));
    try {
      await (verdict === 'approve' ? getApi().approveLine(id) : getApi().rejectLine(id));
      toast({ tone: 'ok', title: verdict === 'approve' ? 'Approved: the line joins the playbook on trial' : 'Line rejected' });
      res.reload();
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not save that', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeciding(({ [id]: _, ...rest }) => rest);
    }
  };

  const d = res.data;
  const fresh = useMemo(() => new Set(changes.length ? changes.map((c) => c.line.id) : highlight), [changes, highlight]);
  const active = useMemo(() => d?.lines.filter((l) => l.status === 'active') ?? [], [d]);
  const candidates = useMemo(() => d?.lines.filter((l) => l.status === 'candidate') ?? [], [d]);

  const moments = useMemo(() => {
    const out: { id: Moment; count: number; rate: number | null }[] = [];
    for (const m of MOMENTS) {
      const ls = active.filter((l) => l.moment === m);
      if (!ls.length) continue;
      out.push({ id: m, count: ls.length, rate: winRate(ls.reduce((s, l) => add(s, total(l)), ZERO)) });
    }
    return out;
  }, [active]);
  const allRate = winRate(active.reduce((s, l) => add(s, total(l)), ZERO));

  const ranked: Ranked[] = useMemo(() => {
    if (!d) return [];
    const trial = new Set<string>();
    const order = new Map<string, number>();
    for (const b of d.leaderboard)
      b.lines.forEach((x, i) => {
        if (x.evidence.basis === 'explore') trial.add(x.lineId);
        if (b.moment === moment) order.set(x.lineId, i);
      });
    const rows = active
      .filter((l) => moment === 'all' || l.moment === moment)
      .filter((l) => persona === 'all' || l.personas.length === 0 || l.personas.includes(persona))
      .map((line) => {
        const stats = statsFor(line, persona);
        return { line, stats, rate: winRate(stats), trial: trial.has(line.id) };
      });
    // The bandit's order for one moment with every persona; otherwise by win rate, then reach.
    const useOrder = moment !== 'all' && persona === 'all';
    return rows.sort((a, b) => {
      if (useOrder) {
        const oa = order.get(a.line.id) ?? Infinity;
        const ob = order.get(b.line.id) ?? Infinity;
        if (oa !== ob) return oa - ob;
      }
      return (b.rate ?? -1) - (a.rate ?? -1) || b.stats.shown - a.stats.shown;
    });
  }, [d, active, moment, persona]);

  const current = d?.lines.find((l) => l.id === selected) ?? ranked[0]?.line ?? candidates[0] ?? null;
  const rank = current ? ranked.findIndex((r) => r.line.id === current.id) : -1;

  const lineColumns: Column<Ranked>[] = [
    { key: 'rank', header: '#', width: '44px', mono: true, render: (_, i) => String(i + 1).padStart(2, '0') },
    {
      key: 'line',
      header: 'Line',
      render: (r) => (
        <span className="web-pb-line">
          <span className="cue-table__line">{r.line.text}</span>
          {moment === 'all' && <MomentChip moment={r.line.moment} size="sm" />}
        </span>
      ),
    },
    { key: 'rate', header: 'Win rate', width: '170px', render: (r) => <Bar value={r.rate ?? 0} label={pct(r.rate)} /> },
    { key: 'calls', header: 'Shown', width: '64px', mono: true, align: 'end', render: (r) => r.stats.shown },
    { key: 'used', header: 'Used', width: '64px', mono: true, align: 'end', render: (r) => r.stats.used },
    {
      key: 'status',
      header: 'Status',
      width: '118px',
      render: (r) => (
        <span className="web-pb-tags">
          <Chip size="sm" tone={r.trial ? 'warn' : 'ok'}>
            {r.trial ? 'On trial' : 'Active'}
          </Chip>
          {fresh.has(r.line.id) && (
            <Chip size="sm" tone="ok" icon="leaf">
              Just learned
            </Chip>
          )}
        </span>
      ),
    },
  ];

  const queueColumns: Column<PlaybookLine>[] = [
    { key: 'moment', header: 'Moment', width: '140px', render: (l) => <MomentChip moment={l.moment} size="sm" /> },
    {
      key: 'line',
      header: 'Line',
      render: (l) => (
        <span className="web-pb-line">
          <span className="cue-table__line">{l.text}</span>
          <span className="web-muted web-small">{l.minedFrom?.repName ? `From ${l.minedFrom.repName}'s call · ${DAY.format(l.createdAt)}` : `From a recent call · ${DAY.format(l.createdAt)}`}</span>
          {l.policy?.verdict === 'violation' && l.policy.note && <span className="web-muted web-small">{l.policy.note}</span>}
          {fresh.has(l.id) && (
            <Chip size="sm" tone="ok" icon="leaf">
              Just learned
            </Chip>
          )}
        </span>
      ),
    },
    {
      key: 'policy',
      header: 'Policy',
      width: '120px',
      render: (l) => {
        const p = policyTag(l);
        return p ? (
          <Chip size="sm" tone={p.tone}>
            {p.label}
          </Chip>
        ) : (
          <span className="web-muted web-small">Not checked</span>
        );
      },
    },
    {
      key: 'decision',
      header: 'Decision',
      width: '228px',
      align: 'end',
      render: (l) => <Decision line={l} busy={deciding[l.id]} onDecide={(v) => void decide(l.id, v)} />,
    },
  ];

  const learned = changes.length > 0 && (
    <section className="cue-pane web-learned" aria-live="polite" aria-labelledby="learned-title">
      <header className="cue-pane__head">
        <Sprout state="learning" size={24} growth={0.6} decorative />
        <h2 className="cue-label cue-pane__label" id="learned-title">
          Just learned
        </h2>
        <span className="cue-pane__meta">{changes.length} {changes.length === 1 ? 'line' : 'lines'} from the last review</span>
      </header>
      <ul className="web-learned__list">
        {changes.slice(0, 6).map((c) => (
          <li key={c.line.id} className={`web-learned__item cue-fam-${MOMENT_META[c.line.moment].family}`}>
            <MomentChip moment={c.line.moment} size="sm" />
            <button type="button" className="web-learned__line" onClick={() => (setMoment(c.line.status === 'active' ? c.line.moment : moment), setSelected(c.line.id))}>
              {c.line.text}
            </button>
            <Chip size="sm" tone={c.added ? 'accent' : c.delta.booked > 0 ? 'ok' : 'neutral'}>
              {c.added ? 'New candidate' : c.totals ? `${c.delta.booked} booked · ${c.delta.used} used` : deltaText(c.delta)}
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  );

  const momentLabel = moment === 'all' ? null : momentParts(moment);

  return (
    <>
      {learned}
      <div className="cue-dash-grid web-pb-grid">
        <Pane label="Moments" as="nav" pad="none" className="web-pb-grid__moments" actions={<span className="cue-label">Win rate</span>} hint="What the prospect just did. Pick one to see its lines; the bar is how often a line moved the call forward.">
          <div className="cue-index">
            <MomentItem name="All moments" count={active.length} rate={allRate} on={moment === 'all'} onClick={() => setMoment('all')} />
            {moments.map((m) => (
              <MomentItem key={m.id} moment={m.id} name={MOMENT_META[m.id].label} count={m.count} rate={m.rate} on={moment === m.id} onClick={() => setMoment(m.id)} />
            ))}
          </div>
        </Pane>

        <Pane
          label="Lines"
          meta={
            momentLabel ? (
              <span className="web-pb-moment">
                {[momentLabel.kind, momentLabel.said, momentLabel.detail].filter(Boolean).join(' · ')} · win = {MOMENT_META[moment as Moment].winRule}
              </span>
            ) : (
              `${ranked.length} active`
            )
          }
          actions={
            <span className="cue-filter" role="group" aria-label="Who's on the line">
              {PERSONA_FILTERS.map((p) => (
                <button key={p} type="button" aria-pressed={persona === p} onClick={() => setPersona(p)}>
                  {p === 'all' ? 'All' : PERSONA_LABEL[p]}
                </button>
              ))}
            </span>
          }
          pad="none"
          className="web-pb-grid__lines"
          hint="The team's best lines, ranked by how often they moved the call forward when used. Filter by who answered."
        >
          <h1 className="web-sr">What books meetings</h1>
          {res.error && !d ? (
            <ErrorState title="Can't load the playbook" message={res.error.message} onRetry={res.reload} className="web-pane-pad" />
          ) : !d ? (
            <div className="web-stack web-pane-pad" aria-busy="true">
              <Skeleton width="30%" height={20} />
              <Skeleton lines={4} />
            </div>
          ) : (
            <DataTable
              label="Ranked lines"
              columns={lineColumns}
              rows={ranked}
              rowKey={(r) => r.line.id}
              selectedKey={current?.id}
              onSelect={(r) => pick(r.line.id)}
              rowFamily={(r) => MOMENT_META[r.line.moment].family}
              minWidth={620}
              empty={
                <EmptyState art={<Sprout state="idle" size={72} />} title={d.lines.length === 0 ? 'No lines yet' : 'No lines here'}>
                  {d.lines.length === 0 ? 'Lines appear here as calls are debriefed. Make a call from Live, then save its debrief.' : 'No active line fits this moment and this kind of person yet. Try All.'}
                </EmptyState>
              }
            />
          )}
        </Pane>

        <LineDetail line={current} rank={rank} trial={ranked.find((r) => r.line.id === current?.id)?.trial ?? false} busy={current ? deciding[current.id] : undefined} onDecide={(id, v) => void decide(id, v)} />

        <Pane label="Waiting for approval" meta={String(candidates.length)} pad="none" className="web-pb-grid__queue" hint="New lines Cue picked up from calls that went well. Approve to try them on live calls; reject to drop them.">
          {d && (
            <DataTable
              label="Lines waiting for approval"
              className="web-pb-queue"
              columns={queueColumns}
              rows={candidates}
              rowKey={(l) => l.id}
              selectedKey={current?.id}
              onSelect={(l) => pick(l.id)}
              rowFamily={(l) => MOMENT_META[l.moment].family}
              minWidth={700}
              empty={
                <EmptyState compact title="Nothing to review">
                  When a rep goes off-script and books, Cue proposes their line here.
                </EmptyState>
              }
            />
          )}
        </Pane>
      </div>
    </>
  );
}

function MomentItem({ moment, name, count, rate, on, onClick }: { moment?: Moment; name: string; count: number; rate: number | null; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`cue-index__item web-pb-mom${moment ? ` cue-fam-${MOMENT_META[moment].family}` : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="cue-index__key" aria-hidden />
      <span className="cue-index__name">{name}</span>
      <span className="cue-index__fig">{count}</span>
      <span className="cue-index__sub">
        <Bar value={rate ?? 0} label={pct(rate)} tone={moment ? 'moment' : 'ink'} />
      </span>
    </button>
  );
}

function Decision({ line, busy, onDecide }: { line: PlaybookLine; busy?: 'approve' | 'reject'; onDecide: (v: 'approve' | 'reject') => void }) {
  const blocked = line.policy?.verdict === 'violation';
  return (
    <span className="cue-table__actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="primary"
        icon="check"
        loading={busy === 'approve'}
        disabled={blocked || !!busy}
        title={blocked ? "Lines that break policy can't be approved" : undefined}
        onClick={() => onDecide('approve')}
      >
        Approve
      </Button>
      <Button size="sm" variant="secondary" icon="close" loading={busy === 'reject'} disabled={!!busy} onClick={() => onDecide('reject')}>
        Reject
      </Button>
    </span>
  );
}

function LineDetail({ line, rank, trial, busy, onDecide }: { line: PlaybookLine | null; rank: number; trial: boolean; busy?: 'approve' | 'reject'; onDecide: (id: string, v: 'approve' | 'reject') => void }) {
  const [copied, setCopied] = useState(false);
  if (!line) {
    return (
      <Pane label="Line" as="aside" className="web-pb-grid__detail">
        <EmptyState compact title="Pick a line">
          Choose a line to see how it does with each kind of person who answers.
        </EmptyState>
      </Pane>
    );
  }
  const t = total(line);
  const policy = policyTag(line);
  const personas = new Map<string, LineStats>();
  for (const [k, v] of Object.entries(line.stats)) {
    if (k === '*') continue;
    const p = k.split('.')[0]!;
    personas.set(p, add(personas.get(p) ?? ZERO, v));
  }
  const byPersona = [...personas.entries()].sort((a, b) => b[1].shown - a[1].shown);
  const candidate = line.status === 'candidate';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast({ tone: 'warn', title: 'Clipboard is blocked', description: 'Select the line and copy it by hand.' });
    }
  };
  return (
    <Pane
      label="Line"
      meta={line.id}
      id="pb-line-detail"
      as="aside"
      pad="none"
      className={`web-pb-grid__detail cue-fam-${MOMENT_META[line.moment].family}`}
      hint="One line in full: how often it was shown, used, moved the call forward and ended in a meeting."
      actions={
        policy && (
          <Chip size="sm" tone={policy.tone}>
            {policy.label}
          </Chip>
        )
      }
      footer={
        <ActionBar
          end={
            candidate ? (
              <>
                <Button size="sm" variant="primary" icon="check" loading={busy === 'approve'} disabled={line.policy?.verdict === 'violation' || !!busy} onClick={() => onDecide(line.id, 'approve')}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" icon="close" loading={busy === 'reject'} disabled={!!busy} onClick={() => onDecide(line.id, 'reject')}>
                  Reject
                </Button>
              </>
            ) : undefined
          }
        >
          <Button size="sm" variant="secondary" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy line'}
          </Button>
        </ActionBar>
      }
    >
      <div className="web-pb-detail">
        <p className="cue-label">{[candidate ? 'Candidate' : rank >= 0 ? `Rank ${String(rank + 1).padStart(2, '0')}` : trial ? 'On trial' : 'Active', MOMENT_META[line.moment].label, line.style].filter(Boolean).join(' · ')}</p>
        <p className="web-pb-detail__text">{line.text}</p>
        {line.policy?.note && <p className="web-muted web-small">{line.policy.note}</p>}
        <StatGrid
          columns={5}
          items={[
            { label: 'Shown', value: t.shown },
            { label: 'Used', value: t.used },
            { label: 'Moved forward', value: t.stepWins },
            { label: 'Booked', value: t.booked },
            { label: 'Lost', value: t.lost },
          ]}
        />
      </div>
      <PaneSection label="By who's on the line" meta={byPersona.length ? undefined : 'no calls yet'}>
        {byPersona.length === 0 ? (
          <p className="web-muted web-small">Win rates by who answered show up once the line has been used on calls.</p>
        ) : (
          <ul className="web-pb-personas">
            {byPersona.map(([p, s]) => {
              const r = winRate(s);
              return (
                <li key={p}>
                  <span className="web-pb-personas__name">{PERSONA_LABEL[p as Persona] ?? p}</span>
                  <Bar value={r ?? 0} label={`${pct(r)} · ${s.shown}`} />
                </li>
              );
            })}
          </ul>
        )}
      </PaneSection>
      <PaneSection label="Origin">
        <p className="web-small web-muted">
          {line.minedFrom?.repName ? `Mined from ${line.minedFrom.repName}'s call` : ORIGIN[line.origin]} on {DAY.format(line.createdAt)}.
          {line.personas.length > 0 ? ` Meant for ${line.personas.map((p) => PERSONA_LABEL[p]).join(', ')}.` : ' Fits anyone.'} Win = {MOMENT_META[line.moment].winRule.toLowerCase()}.
        </p>
      </PaneSection>
    </Pane>
  );
}
