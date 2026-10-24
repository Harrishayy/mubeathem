import type { MomentFamily, MubitTraceSummary, TaskStats } from '@cue/core';
import { Bar, Chip, DataTable, EmptyState, ErrorState, Kpi, KpiStrip, Pane, Skeleton, TASK_COPY, formatMs, formatUsd, type ChipTone, type Column } from '@cue/ui';
import { useResource } from '../hooks/useResource';
import { ADAPTER_THRESHOLD_DEFAULT } from '../shell/constants';
import { getApi } from '../state/api';

/** What one call's CallRecord carries to Mubit (architecture.md §4.3, packages/core CallRecord). */
const RECORD: { field: string; what: string; family: MomentFamily }[] = [
  { field: 'transcript[]', what: 'Every turn: speaker, text and timing', family: 'opener' },
  { field: 'situations[]', what: "Who's on the line, their mood and the moment, for each prospect turn", family: 'cold' },
  { field: 'situations[].tone', what: 'The emotive read: pace, hesitations, laughter, interruptions', family: 'objection' },
  { field: 'suggestions[]', what: 'Each line shown, the situation it was for, how fast it came, who wrote it (Mubit or playbook rules) and its Mubit request ids', family: 'close' },
  { field: 'suggestions[].actions', what: 'Used, edited (with the new text), skipped, thumbs', family: 'signal' },
  { field: 'policyChecks[]', what: 'Claims checked against policy and their verdicts', family: 'compliance' },
  { field: 'outcome', what: 'Booked, follow-up, passed…, from the rep or Trellus', family: 'signal' },
  { field: 'feedback', what: "The rep's debrief: rating, attitude, what worked, a better line", family: 'gatekeeper' },
];

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const threshold = (t: TaskStats) => t.adapterThreshold || ADAPTER_THRESHOLD_DEFAULT;

function taskStatus(t: TaskStats): { label: string; tone: ChipTone } {
  if (t.ok >= threshold(t)) return { label: 'Ready to train', tone: 'ok' };
  if (t.ok > 0) return { label: 'Learning', tone: 'accent' };
  return { label: 'Waiting', tone: 'neutral' };
}

function traceStatus(t: MubitTraceSummary): { label: string; tone: ChipTone } {
  if (t.aborted) return { label: 'Cancelled', tone: 'neutral' };
  if (t.ok) return { label: 'OK', tone: 'ok' };
  return { label: t.errorCode ?? 'Failed', tone: 'bad' };
}

/** "Every call trains it": Mubit spend and calls, each task against its adapter threshold, recent requests. */
export function ModelScreen() {
  const stats = useResource((signal) => getApi().stats({ signal }), [], 3_000);
  const health = useResource((signal) => getApi().health({ signal }), [], 15_000);
  const traces = useResource((signal) => getApi().traces({ limit: 20 }, { signal }), [], 5_000);
  const h = health.data;
  const s = stats.data;
  const tasks = s?.tasks ?? [];
  const calls = tasks.reduce((n, t) => n + t.calls, 0);
  const sessions = tasks.reduce((n, t) => Math.max(n, t.sessions), 0);
  const spend = tasks.reduce((n, t) => n + t.costUsd, 0);
  const trained = tasks.filter((t) => t.ok >= threshold(t)).length;
  const scale = Math.max(...tasks.map((t) => t.ok), ...tasks.map((t) => threshold(t) * 2), 1);

  const taskColumns: Column<TaskStats>[] = [
    {
      key: 'task',
      header: 'AI job',
      render: (t) => (
        <span className="web-model-task">
          <code className="web-model-task__id">{t.task}</code>
          <span className="web-muted web-small">{TASK_COPY[t.task]}</span>
        </span>
      ),
    },
    { key: 'model', header: 'Model', width: '120px', mono: true, render: (t) => t.model },
    {
      key: 'examples',
      header: `Good examples (custom model at ${tasks[0] ? threshold(tasks[0]) : ADAPTER_THRESHOLD_DEFAULT})`,
      width: '210px',
      render: (t) => <Bar value={t.ok / scale} mark={threshold(t) / scale} label={t.ok} tone="ok" />,
    },
    { key: 'ok', header: 'OK', width: '64px', mono: true, align: 'end', render: (t) => (t.calls ? `${Math.round((t.ok / t.calls) * 100)}%` : '—') },
    { key: 'p50', header: 'Typical', width: '76px', mono: true, align: 'end', render: (t) => (t.calls ? formatMs(t.p50Ms) : '—') },
    { key: 'p95', header: 'Slowest 5%', width: '86px', mono: true, align: 'end', render: (t) => (t.calls ? formatMs(t.p95Ms) : '—') },
    {
      key: 'status',
      header: 'Status',
      width: '104px',
      render: (t) => {
        const st = taskStatus(t);
        return (
          <Chip size="sm" tone={st.tone}>
            {st.label}
          </Chip>
        );
      },
    },
  ];

  const traceColumns: Column<MubitTraceSummary>[] = [
    { key: 'at', header: 'Time', width: '112px', mono: true, render: (t) => <time dateTime={new Date(t.at).toISOString()}>{TIME.format(t.at)}</time> },
    { key: 'task', header: 'AI job', width: '172px', mono: true, render: (t) => t.task },
    { key: 'session', header: 'Call', width: '200px', mono: true, render: (t) => <span className="web-muted">{t.callId ?? t.sessionId}</span> },
    { key: 'req', header: 'Request', mono: true, render: (t) => t.requestId ?? <span className="web-muted">no request id</span> },
    { key: 'ms', header: 'Took', width: '80px', mono: true, align: 'end', render: (t) => formatMs(t.latencyMs) },
    {
      key: 'ok',
      header: 'Result',
      width: '110px',
      render: (t) => {
        const st = traceStatus(t);
        return (
          <Chip size="sm" tone={st.tone}>
            {st.label}
          </Chip>
        );
      },
    },
  ];

  // Without the traces endpoint (an older server) fall back to each task's last request id.
  const lastPerTask = tasks.filter((t) => t.lastRequestId);
  const lastColumns: Column<TaskStats>[] = [
    { key: 'task', header: 'AI job', width: '160px', mono: true, render: (t) => t.task },
    { key: 'req', header: 'Last request', mono: true, render: (t) => t.lastRequestId },
    { key: 'p50', header: 'Typical', width: '80px', mono: true, align: 'end', render: (t) => formatMs(t.p50Ms) },
  ];

  const mubitTag = h ? (
    <Chip size="sm" tone={h.mubit.configured ? (h.mubit.reachable === false ? 'bad' : 'ok') : 'warn'}>
      {!h.mubit.configured ? 'Playbook rules only (no Mubit key)' : h.mubit.reachable === false ? 'Mubit unreachable' : h.mubit.reachable === null ? 'Mubit configured' : 'Mubit on'}
    </Chip>
  ) : health.error ? (
    <Chip size="sm" tone="bad">
      Server unreachable
    </Chip>
  ) : null;

  return (
    <>
      <h1 className="web-sr">Every call trains it</h1>
      <KpiStrip>
        <Kpi label="Mubit calls" value={s ? calls.toLocaleString() : '—'} note="Every AI request Cue makes goes through Mubit" />
        <Kpi label="Calls seen" value={s ? sessions.toLocaleString() : '—'} note="Phone calls the AI has worked on" />
        <Kpi label="Spend" value={s ? formatUsd(spend) : '—'} note={h ? `Cheap models only: ${h.mubit.models.fast} and ${h.mubit.models.write}` : 'Cheap models only'} />
        <Kpi label="Custom models" value={s ? `${trained}/${tasks.length}` : '—'} note={`Jobs with ${tasks[0] ? threshold(tasks[0]) : ADAPTER_THRESHOLD_DEFAULT}+ good examples, enough for Mubit to train one (an adapter)`} tone={s && tasks.length > 0 && trained === tasks.length ? 'ok' : 'neutral'} />
      </KpiStrip>
      <div className="cue-dash-grid web-model-grid">
        <Pane label="Tasks" meta={s ? `${tasks.length} jobs` : undefined} actions={mubitTag} pad="none" className="web-model-grid__tasks" hint="Each AI job Cue does on a call. Once a job has enough good examples, Mubit can train a custom model (an adapter) on your team's calls.">
          {h && !h.mubit.configured && tasks.some((t) => t.calls > 0) && (
            <p className="web-note web-model-note" role="note">
              This server has no Mubit key, so new calls use the playbook rules instead of AI. The counts below are from earlier calls.
            </p>
          )}
          {stats.error && !s ? (
            <ErrorState title="Can't load model stats" message={stats.error.message} onRetry={stats.reload} className="web-pane-pad" />
          ) : !s ? (
            <div className="web-pane-pad" aria-busy="true">
              <Skeleton lines={5} />
            </div>
          ) : (
            <DataTable label="Mubit tasks" columns={taskColumns} rows={tasks} rowKey={(t) => t.task} minWidth={760} empty={<EmptyState compact title="No AI jobs yet">They appear after the first call. Start one from Live or Contacts.</EmptyState>} />
          )}
        </Pane>

        <Pane label="What every call sends Mubit" as="aside" pad="none" className="web-model-grid__record" hint="The labelled record each finished call becomes. This is what teaches the AI what works.">
          <ul className="web-record">
            {RECORD.map((r) => (
              <li key={r.field} className={`web-record__item cue-fam-${r.family}`}>
                <span className="cue-index__key" aria-hidden />
                <code className="web-record__field">{r.field}</code>
                <span className="web-record__what">{r.what}</span>
              </li>
            ))}
          </ul>
          <p className="web-model-note web-muted web-small">
            Your debrief labels the whole call, so the call review (<code>review_call</code>) learns which lines book meetings. Requests are not stored by the model provider (<code>store: false</code>) and are grouped per call (<code>prompt_cache_key</code>).
          </p>
        </Pane>

        <Pane label="Recent requests" meta="newest first" pad="none" className="web-model-grid__reqs" hint="The latest AI requests, each with its Mubit request id for tracing.">
          {traces.data ? (
            <DataTable
              label="Recent Mubit requests"
              columns={traceColumns}
              rows={traces.data.items}
              rowKey={(t) => t.id}
              minWidth={760}
              empty={<EmptyState compact title="No requests yet">Each AI request shows up here once you make a call.</EmptyState>}
            />
          ) : traces.error ? (
            <DataTable label="Last request per task" columns={lastColumns} rows={lastPerTask} rowKey={(t) => t.task} minWidth={520} empty={<EmptyState compact title="No requests yet">Each AI request shows up here once you make a call.</EmptyState>} />
          ) : (
            <div className="web-pane-pad" aria-busy="true">
              <Skeleton lines={3} />
            </div>
          )}
        </Pane>
      </div>
    </>
  );
}
