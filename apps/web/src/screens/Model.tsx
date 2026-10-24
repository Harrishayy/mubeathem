import type { MomentFamily, MubitTraceSummary, TaskStats } from '@cue/core';
import { Bar, Chip, DataTable, EmptyState, ErrorState, KeyValue, Kpi, KpiStrip, Pane, Skeleton, TASK_COPY, TASK_LABEL, Toolbar, Workspace, formatMs, formatUsd, type ChipTone, type Column } from '@cue/ui';
import { useEffect, useState } from 'react';
import { useResource } from '../hooks/useResource';
import { ADAPTER_THRESHOLD_DEFAULT } from '../shell/constants';
import { getApi } from '../state/api';
import '../styles/screens/model.css';

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

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TIME_FULL = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

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

type JobsTab = 'progress' | 'record';

/** "Every call trains it": Mubit spend and calls, each AI job against its adapter threshold, recent requests in the drawer. */
export function ModelScreen() {
  const stats = useResource((signal) => getApi().stats({ signal }), [], 3_000);
  const health = useResource((signal) => getApi().health({ signal }), [], 15_000);
  const [tab, setTab] = useState<JobsTab>('progress');
  const h = health.data;
  const s = stats.data;
  const tasks = s?.tasks ?? [];
  const calls = tasks.reduce((n, t) => n + t.calls, 0);
  const sessions = tasks.reduce((n, t) => Math.max(n, t.sessions), 0);
  const spend = tasks.reduce((n, t) => n + t.costUsd, 0);
  const trained = tasks.filter((t) => t.ok >= threshold(t)).length;
  const scale = Math.max(...tasks.map((t) => t.ok), ...tasks.map((t) => threshold(t) * 2), 1);
  const bar = tasks[0] ? threshold(tasks[0]) : ADAPTER_THRESHOLD_DEFAULT;

  const taskColumns: Column<TaskStats>[] = [
    {
      key: 'task',
      header: 'AI job',
      render: (t) => (
        <span className="web-model-job" title={TASK_COPY[t.task]}>
          <span className="web-job__name">{TASK_LABEL[t.task]}</span>
          <code className="web-model-id">{t.task}</code>
        </span>
      ),
    },
    { key: 'model', header: 'Model', width: '118px', mono: true, render: (t) => t.model },
    { key: 'examples', header: 'Good examples', width: '190px', render: (t) => <Bar value={t.ok / scale} mark={threshold(t) / scale} label={t.ok} tone="ok" /> },
    { key: 'ok', header: 'OK', width: '60px', mono: true, align: 'end', render: (t) => (t.calls ? `${Math.round((t.ok / t.calls) * 100)}%` : '—') },
    { key: 'p50', header: 'Typical', width: '76px', mono: true, align: 'end', render: (t) => (t.calls ? formatMs(t.p50Ms) : '—') },
    { key: 'p95', header: 'Slowest 5%', width: '96px', mono: true, align: 'end', render: (t) => (t.calls ? formatMs(t.p95Ms) : '—') },
    {
      key: 'status',
      header: 'Status',
      width: '128px',
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
    <div className="web-screen web-model">
      <h1 className="web-sr">Every call trains it</h1>
      <Toolbar label="Mubit status">
        <span className="cue-label">Mubit</span>
        {mubitTag}
        <span className="web-muted web-small web-toolbar__note">{`Every AI request goes through Mubit. A job with ${bar} good examples can get its own trained model.`}</span>
      </Toolbar>
      <Workspace storageKey="model" drawer={{ label: 'Recent requests', summary: 'newest first', children: <Recent tasks={tasks} /> }}>
        <KpiStrip foldId="kpis">
          <Kpi label="Mubit calls" value={s ? calls.toLocaleString() : '—'} note="every AI request" />
          <Kpi label="Calls seen" value={s ? sessions.toLocaleString() : '—'} note="phone calls worked on" />
          <Kpi label="Spend" value={s ? formatUsd(spend) : '—'} note={h ? `${h.mubit.models.fast} · ${h.mubit.models.write}` : 'cheap models only'} />
          <Kpi label="Custom models" value={s ? `${trained}/${tasks.length}` : '—'} note={`jobs with ${bar}+ good examples`} tone={s && tasks.length > 0 && trained === tasks.length ? 'ok' : 'neutral'} />
        </KpiStrip>
        <Pane
          paneId="jobs"
          label="AI jobs"
          pad="none"
          summary={s ? `${trained} of ${tasks.length} ready to train · ${formatUsd(spend)}` : undefined}
          tabs={[
            { id: 'progress', label: 'Training progress', count: s ? tasks.length : undefined },
            { id: 'record', label: 'What each call sends', count: RECORD.length },
          ]}
          tab={tab}
          onTab={(x) => setTab(x as JobsTab)}
        >
          {tab === 'progress' ? (
            <>
              <p className="cue-hint web-model-hint">{`Each job Cue does on a call. The tick on each bar is ${bar} good examples: enough for Mubit to train a custom model (an adapter) on your team's calls.`}</p>
              {h && !h.mubit.configured && tasks.some((t) => t.calls > 0) && (
                <p className="web-note web-model-note" role="note">
                  This server has no Mubit key, so new calls use the playbook rules instead of AI. The counts below are from earlier calls.
                </p>
              )}
              {stats.error && !s ? (
                <ErrorState title="Can't load model stats" message={stats.error.message} onRetry={stats.reload} className="web-pane-pad" />
              ) : !s ? (
                <div className="web-pad" aria-busy="true">
                  <Skeleton lines={5} />
                </div>
              ) : (
                <DataTable label="AI jobs" columns={taskColumns} rows={tasks} rowKey={(t) => t.task} minWidth={760} empty={<EmptyState compact title="No AI jobs yet">They appear after the first call. Start one from Live or Contacts.</EmptyState>} />
              )}
            </>
          ) : (
            <>
              <p className="cue-hint web-model-hint">What each finished call becomes: a labelled record that teaches the AI which lines work.</p>
              <ul className="web-record web-model-record">
                {RECORD.map((r) => (
                  <li key={r.field} className={`web-record__item cue-fam-${r.family}`}>
                    <span className="cue-index__key" aria-hidden />
                    <code className="web-record__field">{r.field}</code>
                    <span className="web-record__what">{r.what}</span>
                  </li>
                ))}
              </ul>
              <p className="web-model-foot web-muted web-small">
                Your debrief labels the whole call, so the call review (<code>review_call</code>) learns which lines book meetings. Requests are not stored by the model provider (<code>store: false</code>) and are grouped per call (<code>prompt_cache_key</code>).
              </p>
            </>
          )}
        </Pane>
      </Workspace>
    </div>
  );
}

const TRACE_COLS: Column<MubitTraceSummary>[] = [
  { key: 'at', header: 'Time', width: '58px', mono: true, render: (t) => <time dateTime={new Date(t.at).toISOString()} title={TIME_FULL.format(t.at)}>{TIME.format(t.at)}</time> },
  { key: 'task', header: 'Job', className: 'web-nowrap', render: (t) => TASK_LABEL[t.task] ?? t.task },
  {
    key: 'ok',
    header: 'Result',
    width: '88px',
    render: (t) => {
      const st = traceStatus(t);
      return (
        <Chip size="sm" tone={st.tone}>
          {st.label}
        </Chip>
      );
    },
  },
  { key: 'ms', header: 'Took', width: '66px', mono: true, align: 'end', render: (t) => formatMs(t.latencyMs) },
];

/** The drawer: the latest requests, with the picked one's ids below. */
function Recent({ tasks }: { tasks: TaskStats[] }) {
  const traces = useResource((signal) => getApi().traces({ limit: 30 }, { signal }), [], 5_000);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = traces.data?.items ?? [];
  useEffect(() => {
    if (rows.length && !rows.some((t) => t.id === selected)) setSelected(rows[0]!.id);
  }, [rows, selected]);
  const current = rows.find((t) => t.id === selected) ?? null;
  // Without the traces endpoint (an older server) fall back to each task's last request id.
  const lastPerTask = tasks.filter((t) => t.lastRequestId);

  return (
    <Pane label="Recent requests" side="drawer" pad="none" as="aside" meta={traces.data ? String(rows.length) : undefined}>
      <div className="web-split">
        <div className="web-split__top">
          {traces.data ? (
            <DataTable
              label="Recent Mubit requests"
              columns={TRACE_COLS}
              rows={rows}
              rowKey={(t) => t.id}
              selectedKey={current?.id}
              onSelect={(t) => setSelected(t.id)}
              minWidth={300}
              empty={<EmptyState compact title="No requests yet">Each AI request shows up here once you make a call.</EmptyState>}
            />
          ) : traces.error ? (
            <DataTable
              label="Last request per job"
              columns={[
                { key: 'task', header: 'Job', className: 'web-nowrap', render: (t: TaskStats) => TASK_LABEL[t.task] },
                { key: 'req', header: 'Last request', mono: true, render: (t: TaskStats) => t.lastRequestId },
              ]}
              rows={lastPerTask}
              rowKey={(t) => t.task}
              minWidth={300}
              empty={<EmptyState compact title="No requests yet">Each AI request shows up here once you make a call.</EmptyState>}
            />
          ) : (
            <div className="web-pad" aria-busy="true">
              <Skeleton lines={8} />
            </div>
          )}
        </div>
        <div className="web-split__bottom">
          {!current ? (
            <p className="web-muted web-small web-pad">Pick a request to see its ids, for tracing in the Mubit console.</p>
          ) : (
            <section aria-label="Request ids">
              <div className="web-pad web-pad--tight">
                <span className="cue-label">{TASK_LABEL[current.task] ?? current.task}</span>
              </div>
              <KeyValue
                className="web-kv-inset"
                items={[
                  { label: 'Job', value: <code className="web-task">{`${current.task} · v${current.instructionsVersion}`}</code> },
                  { label: 'Model', value: <span className="cue-num">{current.model}</span> },
                  { label: 'Result', value: current.ok ? 'OK' : `${current.errorCode ?? (current.aborted ? 'cancelled' : 'failed')}${current.errorMessage ? `: ${current.errorMessage}` : ''}` },
                  { label: 'Took', value: <span className="cue-num">{`${formatMs(current.latencyMs)} · ${current.inputTokens} in · ${current.outputTokens} out · ${formatUsd(current.costUsd)}`}</span> },
                  { label: 'Request', value: <span className="cue-num">{current.requestId ?? 'no request id'}</span> },
                  { label: 'Call', value: <span className="cue-num">{current.callId ?? current.sessionId}</span> },
                ]}
              />
              <div className="web-pad web-pad--tight">
                <a className="cue-btn cue-btn--secondary cue-btn--sm" href="#/insights">
                  Full detail on Insights
                </a>
              </div>
            </section>
          )}
        </div>
      </div>
    </Pane>
  );
}
