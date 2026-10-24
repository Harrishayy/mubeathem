import { MOMENT_META, formatPercent, type InsightsResponse, type MubitTraceSummary, type TaskId, type TraceRange } from '@cue/core';
import {
  ActionBar,
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
  PaneSection,
  Skeleton,
  Sprout,
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

const TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const BUCKET_TIME = { hour: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }), day: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }) };

/**
 * Insights over every Mubit trace and every call outcome: what books meetings (cues used vs not, per
 * moment, top lines), how each Mubit task is running, and the raw traces with their full input and
 * output, exportable as JSONL, OpenAI fine-tune rows or a Langfuse batch.
 */
export function Insights() {
  const [range, setRange] = useState<TraceRange>('7d');
  const insights = useResource((signal) => getApi().insights(range, { signal }), [range], 30_000);
  const d = insights.data;

  return (
    <div className="web-insights">
      <div className="web-insights__bar">
        <h1 className="web-sr">Insights</h1>
        <span className="cue-label">Range</span>
        <span className="cue-filter" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </span>
        {d && <span className="cue-pane__meta">{`${BUCKET_TIME.day.format(d.since)} → ${BUCKET_TIME.day.format(d.until)}`}</span>}
      </div>
      {insights.error && !d ? (
        <div className="cue-dash-grid">
          <ErrorState title="Can't load insights" message={insights.error.message} onRetry={insights.reload} />
        </div>
      ) : (
        <>
          <Headline d={d} />
          <div className="cue-dash-grid web-insights-grid">
            <Outcomes d={d} />
            <Tasks d={d} />
            <Traces range={range} />
          </div>
        </>
      )}
    </div>
  );
}

function Headline({ d }: { d: InsightsResponse | null }) {
  if (!d) {
    return (
      <KpiStrip>
        {['Mubit calls', 'Succeeded', 'Spend', 'Booking rate', 'Time to a suggestion'].map((l) => (
          <Kpi key={l} label={l} value={<Skeleton width="60%" height={26} />} />
        ))}
      </KpiStrip>
    );
  }
  const o = d.outcomes;
  const lift = o.cueUsage.used.calls > 0 && o.cueUsage.notUsed.calls > 0 ? o.cueUsage.used.bookingRate - o.cueUsage.notUsed.bookingRate : null;
  return (
    <KpiStrip>
      <Kpi label="Mubit calls" value={d.totals.calls.toLocaleString()} note={`AI requests · ${(d.totals.inputTokens + d.totals.outputTokens).toLocaleString()} tokens`} />
      <Kpi label="Succeeded" value={d.totals.calls ? formatPercent(d.totals.ok / d.totals.calls) : '—'} tone={d.totals.calls && d.totals.ok / d.totals.calls < 0.95 ? 'warn' : 'neutral'} note={`${d.totals.calls - d.totals.ok} failed or cancelled (Cue fell back to playbook rules)`} />
      <Kpi label="Spend" value={formatUsd(d.totals.costUsd)} note="At list price, cheap models only" />
      <Kpi
        label="Booking rate"
        value={o.calls.withOutcome ? formatPercent(o.calls.bookingRate) : '—'}
        note={lift === null ? `${o.calls.booked} booked of ${o.calls.withOutcome} with an outcome` : `${lift >= 0 ? '+' : '−'}${Math.round(Math.abs(lift) * 100)} pts when a cue was used`}
        tone={lift !== null && lift > 0 ? 'ok' : 'neutral'}
      />
      <Kpi label="Time to a suggestion" value={o.latency.cards ? formatMs(o.latency.p50Ms) : '—'} note={o.latency.cards ? `Typical, from the prospect speaking to a line on screen. Slowest 5%: ${formatMs(o.latency.p95Ms)} over ${o.latency.cards} suggestions` : 'No suggestions yet'} />
    </KpiStrip>
  );
}

type MomentRow = InsightsResponse['outcomes']['moments'][number];
type LineRow = InsightsResponse['outcomes']['topLines'][number];

function Outcomes({ d }: { d: InsightsResponse | null }) {
  const o = d?.outcomes;
  const momentCols: Column<MomentRow>[] = [
    { key: 'moment', header: 'Moment', render: (m) => <MomentChip moment={m.moment} size="sm" /> },
    { key: 'shown', header: 'Shown', width: '64px', mono: true, render: (m) => m.shown },
    { key: 'used', header: 'Used', width: '22%', render: (m) => <Bar value={m.usedRate} label={formatPercent(m.usedRate)} tone="accent" /> },
    { key: 'step', header: 'Moved forward', width: '20%', render: (m) => (m.judged ? <Bar value={m.stepWinRate} label={formatPercent(m.stepWinRate)} tone="ok" /> : <span className="web-muted">—</span>) },
    { key: 'booked', header: 'Booked', width: '74px', mono: true, render: (m) => (m.shown ? formatPercent(m.bookedRate) : '—') },
  ];
  const lineCols: Column<LineRow>[] = [
    { key: 'line', header: 'Line', render: (l) => <span className="cue-table__line">{l.text}</span> },
    { key: 'moment', header: 'Moment', width: '130px', render: (l) => <MomentChip moment={l.moment} size="sm" /> },
    { key: 'used', header: 'Used', width: '84px', mono: true, render: (l) => `${l.used}/${l.shown}` },
    { key: 'booked', header: 'Booked', width: '74px', mono: true, render: (l) => l.booked },
  ];
  return (
    <Pane label="What books meetings" meta={o ? `${o.calls.total} calls` : undefined} pad="none" className="web-insights-grid__outcomes" hint="Which suggestions turn into meetings: calls where a line was used vs not, each moment, and the top lines.">
      {!o ? (
        <div className="web-pad">
          <Skeleton lines={6} />
        </div>
      ) : o.calls.total === 0 ? (
        <EmptyState art={<Sprout state="idle" size={64} />} title="No calls in this range">
          Make a call from Live (or Contacts) and its outcome shows up here. Try a wider range above.
        </EmptyState>
      ) : (
        <>
          <PaneSection label="Cues used vs not" hint="Booking rate on calls where you used at least one suggestion, against calls where you didn't.">
            <KeyValue
              items={[
                {
                  label: 'Used a cue',
                  value: <Bar value={o.cueUsage.used.bookingRate} tone="ok" label={`${formatPercent(o.cueUsage.used.bookingRate)} booked · ${o.cueUsage.used.calls} ${o.cueUsage.used.calls === 1 ? 'call' : 'calls'}`} />,
                },
                {
                  label: 'No cue used',
                  value: <Bar value={o.cueUsage.notUsed.bookingRate} tone="ink" label={`${formatPercent(o.cueUsage.notUsed.bookingRate)} booked · ${o.cueUsage.notUsed.calls} ${o.cueUsage.notUsed.calls === 1 ? 'call' : 'calls'}`} />,
                },
              ]}
            />
          </PaneSection>
          <PaneSection label="By moment" meta={`${o.moments.length}`} hint="How often a suggestion was used and moved the call forward, by what the prospect had just done.">
            <DataTable label="Outcomes by moment" columns={momentCols} rows={o.moments} rowKey={(m) => m.moment} rowFamily={(m) => MOMENT_META[m.moment].family} minWidth={520} empty={<p className="web-muted">No cards shown yet.</p>} />
          </PaneSection>
          <PaneSection label="Top lines" meta="by booked, then used">
            <DataTable label="Top lines" columns={lineCols} rows={o.topLines} rowKey={(l) => l.lineId} rowFamily={(l) => MOMENT_META[l.moment].family} minWidth={520} empty={<p className="web-muted">No lines used yet.</p>} />
          </PaneSection>
          <PaneSection label="Pipeline" hint="Who wrote each suggestion: the AI (Mubit), the playbook rules as a fallback, or a saved answer.">
            <KeyValue
              items={[
                { label: 'Lines written by', value: <Mix parts={[['Mubit', o.servedBy.cards.mubit], ['Playbook rules', o.servedBy.cards.rules], ['Saved', o.servedBy.cards.cache]]} /> },
                { label: 'Moments read by', value: <Mix parts={[['Mubit', o.servedBy.reads.mubit], ['Playbook rules', o.servedBy.reads.rules]]} /> },
                { label: 'How lines were written', value: <Mix parts={[['Early guess kept', o.writePath.speculative], ['Rewritten after the read', o.writePath.rewritten], ['Written once', o.writePath.direct]]} /> },
                {
                  label: 'Reviews',
                  value: o.reviews.count
                    ? `${o.reviews.count} reviewed${o.reviews.avgSuggestionImpact !== null ? ` · Cue helped ${formatPercent(o.reviews.avgSuggestionImpact)}` : ''}${o.reviews.avgRating !== null ? ` · rated ${o.reviews.avgRating.toFixed(1)}/5` : ''}`
                    : 'None yet',
                },
              ]}
            />
          </PaneSection>
        </>
      )}
    </Pane>
  );
}

/** "Mubit 12 · Rules 2": counts as words, the largest first. */
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
            {k} <span className="cue-num">{v}</span> <span className="web-muted cue-num">({formatPercent(v / total)})</span>
          </span>
        ))}
    </span>
  );
}

type TaskRow = InsightsResponse['tasks'][number];

function Tasks({ d }: { d: InsightsResponse | null }) {
  const cols: Column<TaskRow>[] = [
    { key: 'task', header: 'AI job', render: (t) => <code className="web-task">{t.task}</code> },
    { key: 'calls', header: 'Calls', width: '64px', mono: true, render: (t) => t.calls },
    { key: 'ok', header: 'OK', width: '64px', mono: true, render: (t) => (t.calls ? formatPercent(t.ok / t.calls) : '—') },
    { key: 'p50', header: 'Typical', width: '76px', mono: true, render: (t) => (t.ok ? formatMs(t.p50Ms) : '—') },
    { key: 'p95', header: 'Slowest 5%', width: '86px', mono: true, render: (t) => (t.ok ? formatMs(t.p95Ms) : '—') },
    { key: 'cost', header: 'Cost', width: '80px', mono: true, render: (t) => formatUsd(t.costUsd) },
    {
      key: 'errors',
      header: 'Errors',
      width: '24%',
      render: (t) => {
        const e = Object.entries(t.errorsByCode);
        return e.length ? (
          <span className="web-chips">
            {e.map(([code, n]) => (
              <Chip key={code} size="sm" tone={code === 'aborted' ? 'neutral' : 'bad'}>{`${code} ${n}`}</Chip>
            ))}
          </span>
        ) : (
          <span className="web-muted">None</span>
        );
      },
    },
  ];
  return (
    <Pane label="Mubit tasks" meta={d ? `${d.tasks.length} jobs · per ${d.bucket}` : undefined} pad="none" className="web-insights-grid__tasks" hint="Each AI job Cue runs through Mubit: how many requests, how fast, what it cost and any errors.">
      {!d ? (
        <div className="web-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          <PaneSection label="Activity" meta={`calls per ${d.bucket}`}>
            <Activity d={d} />
          </PaneSection>
          <DataTable label="AI jobs" columns={cols} rows={d.tasks} rowKey={(t) => t.task} minWidth={620} />
        </>
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

const TASK_FILTER: (TaskId | 'all')[] = ['all', 'read_moment', 'write_line', 'check_claim', 'research_brief', 'review_call', 'simulate_prospect'];

function Traces({ range }: { range: TraceRange }) {
  const [task, setTask] = useState<TaskId | 'all'>('all');
  const [failed, setFailed] = useState(false);
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
  const api = getApi();

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api.traces({ ...q, before: cursor });
      setPages((p) => [...p, r.items]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const cols: Column<MubitTraceSummary>[] = [
    { key: 'at', header: 'Time', width: '128px', mono: true, render: (t) => TIME.format(t.at) },
    { key: 'task', header: 'AI job', width: '140px', render: (t) => <code className="web-task">{t.task}</code> },
    { key: 'ok', header: 'Result', width: '96px', render: (t) => <Chip size="sm" tone={t.ok ? 'ok' : t.aborted ? 'neutral' : 'bad'}>{t.ok ? 'OK' : t.aborted ? 'Cancelled' : t.errorCode ?? 'Failed'}</Chip> },
    { key: 'ms', header: 'Took', width: '76px', mono: true, render: (t) => formatMs(t.latencyMs) },
    { key: 'tok', header: 'Tokens', width: '96px', mono: true, render: (t) => `${t.inputTokens}/${t.outputTokens}` },
    { key: 'req', header: 'Request', mono: true, render: (t) => t.requestId ?? <span className="web-muted">—</span> },
  ];

  return (
    <>
      <Pane
        label="Traces"
        meta={`${rows.length}${cursor ? '+' : ''} · ${RANGES.find((r) => r.value === range)!.label.toLowerCase()} totals above`}
        actions={
          <>
            <label className="web-sr" htmlFor="trace-task">
              AI job
            </label>
            <select id="trace-task" className="web-input web-input--sm" value={task} onChange={(e) => setTask(e.target.value as TaskId | 'all')}>
              {TASK_FILTER.map((t) => (
                <option key={t} value={t}>
                  {t === 'all' ? 'All AI jobs' : t}
                </option>
              ))}
            </select>
            <span className="cue-filter" role="group" aria-label="Result">
              <button type="button" aria-pressed={!failed} onClick={() => setFailed(false)}>
                All
              </button>
              <button type="button" aria-pressed={failed} onClick={() => setFailed(true)}>
                Failed
              </button>
            </span>
          </>
        }
        pad="none"
        className="web-insights-grid__traces"
        hint="Every AI request, newest first. Pick one to see exactly what went in and what came back."
        footer={
          <ActionBar
            end={
              <>
                <span className="cue-label">Export {RANGES.find((r) => r.value === range)!.label.toLowerCase()}</span>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={api.traceExportUrl({ format: 'jsonl', range, ...(task === 'all' ? {} : { task }) })} download>
                  JSONL
                </a>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={api.traceExportUrl({ format: 'openai', range, ...(task === 'all' ? {} : { task }) })} download>
                  OpenAI fine-tune
                </a>
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href={api.traceExportUrl({ format: 'langfuse', range, ...(task === 'all' ? {} : { task }) })} download>
                  Langfuse
                </a>
              </>
            }
          >
            {cursor && (
              <Button size="sm" variant="ghost" onClick={() => void more()} loading={loadingMore}>
                Load older
              </Button>
            )}
          </ActionBar>
        }
      >
        {first.error && rows.length === 0 ? (
          <div className="web-pad">
            <ErrorState compact title="Can't load traces" message={first.error.message} onRetry={first.reload} />
          </div>
        ) : !first.data && rows.length === 0 ? (
          <div className="web-pad">
            <Skeleton lines={8} />
          </div>
        ) : (
          <DataTable
            label="Mubit traces"
            columns={cols}
            rows={rows}
            rowKey={(t) => t.id}
            selectedKey={selected}
            onSelect={(t) => setSelected(t.id)}
            minWidth={720}
            empty={
              <EmptyState compact title="No traces yet">
                Each AI request lands here with its input and output once you make a call.
              </EmptyState>
            }
          />
        )}
      </Pane>
      <TraceDetailPane id={selected} />
    </>
  );
}

function TraceDetailPane({ id }: { id: string | null }) {
  const detail = useResource((signal) => (id ? getApi().trace(id, { signal }) : Promise.resolve(null)), [id]);
  const t = detail.data;
  return (
    <Pane label="Trace" meta={t ? t.id : undefined} as="aside" pad="none" className="web-insights-grid__trace" hint="One AI request in full: the job, model, timing, cost, input and output.">
      {!id ? (
        <EmptyState compact title="Pick a trace">
          Select a row to see exactly what Cue sent Mubit and what came back.
        </EmptyState>
      ) : detail.error ? (
        <div className="web-pad">
          <ErrorState compact title="Can't load the trace" message={detail.error.message} onRetry={detail.reload} />
        </div>
      ) : !t ? (
        <div className="web-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          <div className="web-pad">
            <KeyValue
              items={[
                { label: 'AI job', value: <code className="web-task">{`${t.task} · v${t.instructionsVersion}`}</code> },
                { label: 'Model', value: <span className="cue-num">{t.model}</span> },
                { label: 'Request', value: <span className="cue-num">{t.requestId ?? '—'}</span> },
                { label: 'Call', value: <span className="cue-num">{t.callId ?? t.sessionId}</span> },
                ...(t.suggestionId ? [{ label: 'Suggestion', value: <span className="cue-num">{t.suggestionId}</span> }] : []),
                { label: 'Result', value: t.ok ? 'OK' : `${t.errorCode ?? 'failed'}${t.errorMessage ? `: ${t.errorMessage}` : ''}` },
                { label: 'Took', value: <span className="cue-num">{`${formatMs(t.latencyMs)} · ${t.attempts || '?'} attempt${t.attempts === 1 ? '' : 's'}`}</span> },
                { label: 'Tokens', value: <span className="cue-num">{`${t.inputTokens} in · ${t.outputTokens} out · ${formatUsd(t.costUsd)}`}</span> },
              ]}
            />
            {t.truncated && <p className="web-note web-note--warn">A body was over the size cap and is stored cut short.</p>}
          </div>
          <PaneSection label="Input">
            <Json value={t.input} />
          </PaneSection>
          <PaneSection label="Output">
            <Json value={t.output} />
          </PaneSection>
        </>
      )}
    </Pane>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="web-muted">Not kept (metadata mode, or the call failed).</p>;
  return <pre className="web-json">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}
