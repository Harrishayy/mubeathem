import { MOMENT_META, formatPercent, type InsightsResponse, type MubitTraceSummary, type TaskId, type TraceRange } from '@cue/core';
import {
  Bar,
  Button,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  KeyValue,
  Kpi,
  KpiStrip,
  MomentChip,
  Pane,
  Skeleton,
  Sprout,
  StatGrid,
  TASK_LABEL,
  Toolbar,
  Workspace,
  formatMs,
  formatUsd,
  type Column,
} from '@cue/ui';
import { useEffect, useState } from 'react';
import { useResource } from '../hooks/useResource';
import { getApi } from '../state/api';

const RANGES: { value: TraceRange; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
];

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const BUCKET_TIME = { hour: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }), day: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }) };
const TASKS: TaskId[] = ['read_moment', 'write_line', 'check_claim', 'research_brief', 'review_call', 'simulate_prospect'];

type OutcomeTab = 'moment' | 'lines' | 'who';
type JobsTab = 'jobs' | 'activity';

/**
 * Insights over every Mubit trace and every call outcome. Rail: which requests to list and the
 * exports. Centre: headline numbers, what books meetings (by moment, top lines, who wrote them) and
 * the AI jobs. Drawer: the requests, newest first, with the chosen one in full.
 */
export function Insights() {
  const [range, setRange] = useState<TraceRange>('7d');
  const [task, setTask] = useState<TaskId | 'all'>('all');
  const [failed, setFailed] = useState(false);
  const [outTab, setOutTab] = useState<OutcomeTab>('moment');
  const [jobsTab, setJobsTab] = useState<JobsTab>('jobs');
  const insights = useResource((signal) => getApi().insights(range, { signal }), [range], 30_000);
  const d = insights.data;
  const rangeWords = RANGES.find((r) => r.value === range)!.label.toLowerCase();
  const api = getApi();
  const exportHref = (format: 'jsonl' | 'openai' | 'langfuse') => api.traceExportUrl({ format, range, ...(task === 'all' ? {} : { task }) });

  return (
    <div className="web-screen">
      <h1 className="web-sr">Insights</h1>
      <Toolbar label="Insights range">
        <span className="cue-label">Range</span>
        <span className="cue-filter" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </span>
        {d && <span className="cue-pane__meta">{`${BUCKET_TIME.day.format(d.since)} → ${BUCKET_TIME.day.format(d.until)}`}</span>}
      </Toolbar>
      <Workspace
        storageKey="insights"
        rail={{
          label: 'Filters',
          summary: task === 'all' && !failed ? 'all requests' : [task === 'all' ? null : TASK_LABEL[task], failed ? 'failed only' : null].filter(Boolean).join(', '),
          children: (
            <Pane label="Filters" side="rail" pad="none" hint="Which requests the drawer lists, and what the exports contain.">
              <fieldset className="web-railsec">
                <legend className="cue-label">AI job</legend>
                <label className="web-check">
                  <input type="radio" name="ins-task" checked={task === 'all'} onChange={() => setTask('all')} />
                  All AI jobs
                </label>
                {TASKS.map((t) => (
                  <label key={t} className="web-check">
                    <input type="radio" name="ins-task" checked={task === t} onChange={() => setTask(t)} />
                    {TASK_LABEL[t]}
                    <span className="cue-pane__meta">{d?.tasks.find((x) => x.task === t)?.calls ?? ''}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="web-railsec">
                <legend className="cue-label">Result</legend>
                <label className="web-check">
                  <input type="radio" name="ins-res" checked={!failed} onChange={() => setFailed(false)} />
                  Everything
                </label>
                <label className="web-check">
                  <input type="radio" name="ins-res" checked={failed} onChange={() => setFailed(true)} />
                  Failed only
                </label>
              </fieldset>
              <div className="web-railsec">
                <span className="cue-label">{`Export ${rangeWords}`}</span>
                <span className="web-muted web-small">Every request with its input and output, for training or analysis.</span>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={exportHref('jsonl')} download>
                  JSONL
                </a>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={exportHref('openai')} download>
                  OpenAI fine-tune
                </a>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={exportHref('langfuse')} download>
                  Langfuse
                </a>
              </div>
            </Pane>
          ),
        }}
        drawer={{
          label: 'Requests',
          summary: failed ? 'failed only' : 'newest first',
          children: <Requests task={task} failed={failed} />,
        }}
      >
        {insights.error && !d ? (
          <ErrorState title="Can't load insights" message={insights.error.message} onRetry={insights.reload} />
        ) : (
          <>
            <Headline d={d} />
            <Outcomes d={d} tab={outTab} onTab={setOutTab} />
            <Jobs d={d} tab={jobsTab} onTab={setJobsTab} />
          </>
        )}
      </Workspace>
    </div>
  );
}

function Headline({ d }: { d: InsightsResponse | null }) {
  if (!d) {
    return (
      <KpiStrip>
        {['Mubit calls', 'Succeeded', 'Spend', 'Booking rate', 'To a suggestion'].map((l) => (
          <Kpi key={l} label={l} value={<Skeleton width="60%" height={24} />} />
        ))}
      </KpiStrip>
    );
  }
  const o = d.outcomes;
  const lift = o.cueUsage.used.calls > 0 && o.cueUsage.notUsed.calls > 0 ? o.cueUsage.used.bookingRate - o.cueUsage.notUsed.bookingRate : null;
  return (
    <KpiStrip foldId="kpis">
      <Kpi label="Mubit calls" value={d.totals.calls.toLocaleString()} note={`${compact(d.totals.inputTokens + d.totals.outputTokens)} tokens`} />
      <Kpi label="Succeeded" value={d.totals.calls ? formatPercent(d.totals.ok / d.totals.calls) : '—'} tone={d.totals.calls && d.totals.ok / d.totals.calls < 0.95 ? 'warn' : 'neutral'} note={`${d.totals.calls - d.totals.ok} fell back to rules`} />
      <Kpi label="Spend" value={formatUsd(d.totals.costUsd)} note="cheap models only" />
      <Kpi
        label="Booking rate"
        value={o.calls.withOutcome ? formatPercent(o.calls.bookingRate) : '—'}
        note={lift === null ? `${o.calls.booked} of ${o.calls.withOutcome} calls` : `${lift >= 0 ? '+' : '−'}${Math.round(Math.abs(lift) * 100)} pts with a cue`}
        tone={lift !== null && lift > 0 ? 'ok' : 'neutral'}
      />
      <Kpi label="To a suggestion" value={o.latency.cards ? formatMs(o.latency.p50Ms) : '—'} note={o.latency.cards ? `slowest 5% ${formatMs(o.latency.p95Ms)}` : 'No suggestions yet'} />
    </KpiStrip>
  );
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

type MomentRow = InsightsResponse['outcomes']['moments'][number];
type LineRow = InsightsResponse['outcomes']['topLines'][number];

const MOMENT_COLS: Column<MomentRow>[] = [
  { key: 'moment', header: 'Moment', width: '190px', render: (m) => <MomentChip moment={m.moment} size="sm" /> },
  { key: 'shown', header: 'Shown', width: '80px', mono: true, align: 'end', render: (m) => m.shown },
  { key: 'used', header: 'Used', render: (m) => <Bar value={m.usedRate} label={formatPercent(m.usedRate)} tone="accent" /> },
  { key: 'step', header: 'Moved forward', render: (m) => (m.judged ? <Bar value={m.stepWinRate} label={formatPercent(m.stepWinRate)} tone="ok" /> : <span className="web-muted">—</span>) },
  { key: 'booked', header: 'Booked', width: '90px', mono: true, align: 'end', render: (m) => (m.shown ? formatPercent(m.bookedRate) : '—') },
];

const LINE_COLS: Column<LineRow>[] = [
  { key: 'line', header: 'Line', render: (l) => <span className="cue-table__line">{l.text}</span> },
  { key: 'moment', header: 'Moment', width: '180px', render: (l) => <MomentChip moment={l.moment} size="sm" /> },
  { key: 'used', header: 'Used', width: '84px', mono: true, align: 'end', render: (l) => `${l.used}/${l.shown}` },
  { key: 'booked', header: 'Booked', width: '90px', mono: true, align: 'end', render: (l) => l.booked },
];

function Outcomes({ d, tab, onTab }: { d: InsightsResponse | null; tab: OutcomeTab; onTab: (t: OutcomeTab) => void }) {
  const o = d?.outcomes;
  const best = o?.moments.filter((m) => m.shown > 0).sort((a, b) => b.bookedRate - a.bookedRate)[0];
  const summary = o
    ? `${formatPercent(o.cueUsage.used.bookingRate)} booked with a cue, ${formatPercent(o.cueUsage.notUsed.bookingRate)} without${best ? ` · ${MOMENT_META[best.moment].label.toLowerCase()} books ${formatPercent(best.bookedRate)}` : ''}`
    : undefined;
  return (
    <Pane
      paneId="outcomes"
      label="What books meetings"
      grow={1.3}
      pad="none"
      summary={summary}
      tabs={[
        { id: 'moment', label: 'By moment', count: o?.moments.length },
        { id: 'lines', label: 'Top lines', count: o?.topLines.length },
        { id: 'who', label: 'Who wrote them' },
      ]}
      tab={tab}
      onTab={(t) => onTab(t as OutcomeTab)}
    >
      {!o ? (
        <div className="web-pad">
          <Skeleton lines={6} />
        </div>
      ) : o.calls.total === 0 ? (
        <EmptyState art={<Sprout state="idle" size={64} />} title="No calls in this range">
          Make a call from Live or Contacts and its outcome shows up here. Try a wider range.
        </EmptyState>
      ) : tab === 'moment' ? (
        <DataTable label="Outcomes by moment" columns={MOMENT_COLS} rows={o.moments} rowKey={(m) => m.moment} rowFamily={(m) => MOMENT_META[m.moment].family} minWidth={640} empty={<p className="web-muted web-pad">No cards shown yet.</p>} />
      ) : tab === 'lines' ? (
        <DataTable label="Top lines" columns={LINE_COLS} rows={o.topLines} rowKey={(l) => l.lineId} rowFamily={(l) => MOMENT_META[l.moment].family} minWidth={600} empty={<p className="web-muted web-pad">No lines used yet.</p>} />
      ) : (
        <StatGrid
          columns={2}
          items={[
            { label: 'Booked when a cue was used', value: formatPercent(o.cueUsage.used.bookingRate), note: `${o.cueUsage.used.calls} calls. Without a cue: ${formatPercent(o.cueUsage.notUsed.bookingRate)} over ${o.cueUsage.notUsed.calls}.` },
            {
              label: 'Cue helped, by review',
              value: o.reviews.avgSuggestionImpact !== null ? formatPercent(o.reviews.avgSuggestionImpact) : '—',
              note: o.reviews.count ? `${o.reviews.count} calls reviewed${o.reviews.avgRating !== null ? ` · reps rated them ${o.reviews.avgRating.toFixed(1)}/5` : ''}` : 'No reviews yet',
            },
            { label: 'Lines written by', value: <Mix parts={[['Mubit', o.servedBy.cards.mubit], ['Playbook rules', o.servedBy.cards.rules], ['Saved', o.servedBy.cards.cache]]} />, note: 'Playbook rules write the instant line and cover when Mubit is slow' },
            { label: 'How lines were written', value: <Mix parts={[['Early guess kept', o.writePath.speculative], ['Rewritten after the read', o.writePath.rewritten], ['Written once', o.writePath.direct]]} />, note: `Moments read by Mubit ${o.servedBy.reads.mubit}, by rules ${o.servedBy.reads.rules}` },
          ]}
        />
      )}
    </Pane>
  );
}

/** "Mubit 99% · Rules 1%": shares as words, the largest first. */
function Mix({ parts }: { parts: [string, number][] }) {
  const total = parts.reduce((n, [, v]) => n + v, 0);
  if (!total) return <span className="web-muted">—</span>;
  return (
    <span className="web-mix">
      {parts
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => (
          <span key={k}>
            {k} <span className="cue-num">{formatPercent(v / total)}</span>
          </span>
        ))}
    </span>
  );
}

type TaskRow = InsightsResponse['tasks'][number];

const JOB_COLS: Column<TaskRow>[] = [
  {
    key: 'task',
    header: 'AI job',
    render: (t) => (
      <span className="web-job__name" title={t.task}>
        {TASK_LABEL[t.task]}
      </span>
    ),
  },
  { key: 'calls', header: 'Calls', width: '80px', mono: true, align: 'end', render: (t) => t.calls },
  { key: 'ok', header: 'OK', width: '72px', mono: true, align: 'end', render: (t) => (t.calls ? formatPercent(t.ok / t.calls) : '—') },
  { key: 'p50', header: 'Typical', width: '84px', mono: true, align: 'end', render: (t) => (t.ok ? formatMs(t.p50Ms) : '—') },
  { key: 'p95', header: 'Slowest 5%', width: '104px', mono: true, align: 'end', render: (t) => (t.ok ? formatMs(t.p95Ms) : '—') },
  { key: 'cost', header: 'Cost', width: '84px', mono: true, align: 'end', render: (t) => formatUsd(t.costUsd) },
  {
    key: 'errors',
    header: 'Errors',
    width: '170px',
    render: (t) => {
      const e = Object.entries(t.errorsByCode);
      return e.length ? (
        <span className="web-chips">
          {e.map(([code, n]) => (
            <Chip key={code} size="sm" tone={code === 'aborted' ? 'neutral' : 'bad'}>{`${code === 'aborted' ? 'cancelled' : code} ${n}`}</Chip>
          ))}
        </span>
      ) : (
        <span className="web-muted">None</span>
      );
    },
  },
];

function Jobs({ d, tab, onTab }: { d: InsightsResponse | null; tab: JobsTab; onTab: (t: JobsTab) => void }) {
  const errors = d ? d.tasks.reduce((n, t) => n + Object.entries(t.errorsByCode).reduce((m, [code, c]) => m + (code === 'aborted' ? 0 : c), 0), 0) : 0;
  const slowest = d?.tasks.filter((t) => t.ok).sort((a, b) => b.p95Ms - a.p95Ms)[0];
  return (
    <Pane
      paneId="jobs"
      label="AI jobs"
      pad="none"
      summary={d ? `${errors} errors · slowest ${slowest ? `${TASK_LABEL[slowest.task].toLowerCase()} ${formatMs(slowest.p95Ms)}` : '—'} · ${formatUsd(d.totals.costUsd)}` : undefined}
      tabs={[
        { id: 'jobs', label: 'Jobs', count: d?.tasks.length },
        { id: 'activity', label: `Requests per ${d?.bucket ?? 'day'}` },
      ]}
      tab={tab}
      onTab={(t) => onTab(t as JobsTab)}
    >
      {!d ? (
        <div className="web-pad">
          <Skeleton lines={5} />
        </div>
      ) : tab === 'jobs' ? (
        <DataTable label="AI jobs" columns={JOB_COLS} rows={d.tasks} rowKey={(t) => t.task} minWidth={760} empty={<p className="web-muted web-pad">No AI requests in this range.</p>} />
      ) : (
        <div className="web-pad">
          <Activity d={d} />
        </div>
      )}
    </Pane>
  );
}

/** Calls per bucket as a column chart; each column's figure is in its accessible label. */
function Activity({ d }: { d: InsightsResponse }) {
  const byT = new Map<number, { calls: number; cost: number }>();
  for (const p of d.series) {
    const cur = byT.get(p.t) ?? { calls: 0, cost: 0 };
    cur.calls += p.calls;
    cur.cost += p.costUsd;
    byT.set(p.t, cur);
  }
  const cols = [...byT.entries()].sort((a, b) => a[0] - b[0]).slice(-48);
  if (cols.length === 0) return <p className="web-muted">No Mubit calls in this range.</p>;
  const max = Math.max(1, ...cols.map(([, v]) => v.calls));
  const fmt = BUCKET_TIME[d.bucket];
  return (
    <figure className="web-activity" aria-label={`Mubit calls per ${d.bucket}`}>
      <ol className="web-activity__cols">
        {cols.map(([t, v]) => (
          <li key={t} className="web-activity__col" title={`${fmt.format(t)}: ${v.calls} calls, ${formatUsd(v.cost)}`}>
            <span className="web-activity__bar" style={{ transform: `scaleY(${(v.calls / max).toFixed(3)})` }} aria-hidden />
            <span className="cue-vh">{`${fmt.format(t)}: ${v.calls} calls`}</span>
          </li>
        ))}
      </ol>
      <figcaption className="web-activity__axis">
        <span>{fmt.format(cols[0]![0])}</span>
        <span>{`peak ${max}`}</span>
        <span>{fmt.format(cols.at(-1)![0])}</span>
      </figcaption>
    </figure>
  );
}

const TRACE_COLS: Column<MubitTraceSummary>[] = [
  { key: 'at', header: 'Time', width: '76px', mono: true, render: (t) => TIME.format(t.at) },
  { key: 'task', header: 'Job', className: 'web-nowrap', render: (t) => TASK_LABEL[t.task] ?? t.task },
  { key: 'ok', header: 'Result', width: '96px', render: (t) => <Chip size="sm" tone={t.ok ? 'ok' : t.aborted ? 'neutral' : 'bad'}>{t.ok ? 'OK' : t.aborted ? 'Cancelled' : (t.errorCode ?? 'Failed')}</Chip> },
  { key: 'ms', header: 'Took', width: '70px', mono: true, align: 'end', render: (t) => formatMs(t.latencyMs) },
];

/** The drawer: requests, newest first, with the chosen one in full below. */
function Requests({ task, failed }: { task: TaskId | 'all'; failed: boolean }) {
  const [pages, setPages] = useState<MubitTraceSummary[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const q = { ...(task === 'all' ? {} : { task }), ...(failed ? { ok: false } : {}), limit: 50 };
  const first = useResource((signal) => getApi().traces(q, { signal }), [task, failed], 15_000);
  useEffect(() => {
    if (!first.data) return;
    setPages([first.data.items]);
    setCursor(first.data.nextCursor);
  }, [first.data]);
  const rows = pages.flat();
  useEffect(() => {
    if (!selected && rows[0]) setSelected(rows[0].id);
  }, [rows, selected]);

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await getApi().traces({ ...q, before: cursor });
      setPages((p) => [...p, r.items]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Pane label="Requests" side="drawer" pad="none" meta={`${rows.length}${cursor ? '+' : ''}`} as="aside">
      <div className="web-split">
        <div className="web-split__top">
          {first.error && rows.length === 0 ? (
            <div className="web-pad">
              <ErrorState compact title="Can't load requests" message={first.error.message} onRetry={first.reload} />
            </div>
          ) : !first.data && rows.length === 0 ? (
            <div className="web-pad">
              <Skeleton lines={8} />
            </div>
          ) : (
            <>
              <DataTable
                label="Mubit requests"
                columns={TRACE_COLS}
                rows={rows}
                rowKey={(t) => t.id}
                selectedKey={selected}
                onSelect={(t) => setSelected(t.id)}
                minWidth={330}
                empty={
                  <EmptyState compact title="No requests yet">
                    Each AI request lands here with its input and output once you make a call.
                  </EmptyState>
                }
              />
              {cursor && (
                <div className="web-pad web-pad--tight">
                  <Button size="sm" variant="ghost" onClick={() => void more()} loading={loadingMore}>
                    Load older requests
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="web-split__bottom">
          <TraceDetail id={selected} />
        </div>
      </div>
    </Pane>
  );
}

function TraceDetail({ id }: { id: string | null }) {
  const detail = useResource((signal) => (id ? getApi().trace(id, { signal }) : Promise.resolve(null)), [id]);
  const t = detail.data;
  if (!id) return <p className="web-muted web-small web-pad">Pick a request to see exactly what Cue sent Mubit and what came back.</p>;
  if (detail.error)
    return (
      <div className="web-pad">
        <ErrorState compact title="Can't load the request" message={detail.error.message} onRetry={detail.reload} />
      </div>
    );
  if (!t)
    return (
      <div className="web-pad">
        <Skeleton lines={5} />
      </div>
    );
  return (
    <section aria-label="Request detail">
      <div className="web-pad web-pad--tight">
        <span className="cue-label">{TASK_LABEL[t.task] ?? t.task}</span>
      </div>
      <KeyValue
        className="web-kv-inset"
        items={[
          { label: 'Job', value: <code className="web-task">{`${t.task} · v${t.instructionsVersion}`}</code> },
          { label: 'Model', value: <span className="cue-num">{t.model}</span> },
          { label: 'Result', value: t.ok ? 'OK' : `${t.errorCode ?? 'failed'}${t.errorMessage ? `: ${t.errorMessage}` : ''}` },
          { label: 'Took', value: <span className="cue-num">{`${formatMs(t.latencyMs)} · ${t.inputTokens} in · ${t.outputTokens} out · ${formatUsd(t.costUsd)}`}</span> },
          { label: 'Request', value: <span className="cue-num">{t.requestId ?? '—'}</span> },
          { label: 'Call', value: <span className="cue-num">{t.callId ?? t.sessionId}</span> },
        ]}
      />
      {t.truncated && <p className="web-note web-note--warn">A body was over the size cap and is stored cut short.</p>}
      <div className="web-pad web-pad--tight">
        <span className="cue-label">Input</span>
      </div>
      <Json value={t.input} />
      <div className="web-pad web-pad--tight">
        <span className="cue-label">Output</span>
      </div>
      <Json value={t.output} />
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="web-muted web-small web-pad">Not kept (metadata mode, or the call failed).</p>;
  return <pre className="web-json web-json--inset">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}
