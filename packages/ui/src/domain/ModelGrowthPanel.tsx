import type { StatsResponse, TaskStats } from '@cue/core';
import { useState } from 'react';
import { cx } from '../lib/cx';
import { formatMs, formatUsd } from '../lib/core';
import { Sprout } from '../mascot/Sprout';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Meter } from '../primitives/Meter';

export interface ModelGrowthPanelProps {
  stats: StatsResponse;
  /** Updating in real time (shows a live marker). */
  live?: boolean;
  className?: string;
}

export const TASK_COPY: Record<TaskStats['task'], string> = {
  read_moment: 'Reads who, receptivity and the moment',
  write_line: 'Tailors the line to say',
  research_brief: 'Turns research into hooks',
  check_claim: 'Checks claims against policy',
  review_call: 'Learns what worked after the call',
  simulate_prospect: 'Plays the prospect in practice',
};

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="cue-task__req">
      <code title={id}>{id}</code>
      <IconButton
        icon={done ? 'check' : 'copy'}
        label={done ? 'Copied' : 'Copy request id'}
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {
            /* clipboard blocked */
          }
        }}
      />
    </span>
  );
}

function TaskRow({ t }: { t: TaskStats }) {
  const kept = t.ok;
  const growth = t.adapterThreshold > 0 ? kept / t.adapterThreshold : 0;
  const ready = growth >= 1;
  return (
    <li className={cx('cue-task', ready && 'is-ready', kept === 0 && 'is-empty')}>
      <Sprout state={kept === 0 ? 'idle' : 'learning'} growth={growth} size={44} className="cue-task__sprout" />
      <div className="cue-task__id">
        <p className="cue-task__name">
          <code>{t.task}</code>
          <span className="cue-task__model">{t.model}</span>
        </p>
        <p className="cue-task__desc">{TASK_COPY[t.task]}</p>
      </div>
      <div className="cue-task__progress">
        <Meter
          value={Math.min(kept, t.adapterThreshold)}
          max={t.adapterThreshold}
          tone={ready ? 'ok' : 'accent'}
          label={`${t.task} examples towards its adapter`}
          valueText={ready ? `${kept} kept` : `${kept} / ${t.adapterThreshold}`}
        />
        <p className={cx('cue-task__status', ready && 'is-ready')}>
          {ready ? (
            <>
              <Icon name="check" size={13} /> Ready for an adapter
            </>
          ) : kept === 0 ? (
            'No calls yet'
          ) : (
            `${t.adapterThreshold - kept} more to its first adapter`
          )}
        </p>
      </div>
      <dl className="cue-task__nums">
        <div>
          <dt>p50</dt>
          <dd>{t.calls ? formatMs(t.p50Ms) : '–'}</dd>
        </div>
        <div>
          <dt>p95</dt>
          <dd>{t.calls ? formatMs(t.p95Ms) : '–'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{formatUsd(t.costUsd)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{t.sessions}</dd>
        </div>
      </dl>
      {t.lastRequestId && <CopyId id={t.lastRequestId} />}
    </li>
  );
}

/**
 * "Your model is growing": every task Cue sends through Mubit, its progress to the 25-example
 * adapter threshold (a Sprout per task grows its third leaf, blooming when ready), latency and cost.
 */
export function ModelGrowthPanel({ stats, live, className }: ModelGrowthPanelProps) {
  const ready = stats.tasks.filter((t) => t.ok >= t.adapterThreshold).length;
  const total = stats.tasks.reduce((n, t) => n + t.calls, 0);
  const avg = stats.tasks.length ? stats.tasks.reduce((n, t) => n + Math.min(1, t.ok / (t.adapterThreshold || 1)), 0) / stats.tasks.length : 0;
  return (
    <section className={cx('cue-model', className)} aria-labelledby="cue-model-title">
      <header className="cue-model__head">
        <Sprout state={ready === stats.tasks.length && ready > 0 ? 'celebrating' : 'learning'} growth={avg} size={96} />
        <div className="cue-model__intro">
          <h2 className="cue-model__title" id="cue-model-title">
            Your model is growing
            {live && (
              <span className="cue-model__live">
                <span className="cue-bar__live-dot" aria-hidden /> Live
              </span>
            )}
          </h2>
          <p className="cue-model__lede">
            {ready} of {stats.tasks.length} tasks have enough examples for Mubit to train an adapter: a small model built on your team's calls.
          </p>
          <dl className="cue-model__totals">
            <div>
              <dt>Model calls</dt>
              <dd>{total}</dd>
            </div>
            <div>
              <dt>Phone calls</dt>
              <dd>{stats.calls.total}</dd>
            </div>
            <div>
              <dt>Booked</dt>
              <dd>{stats.calls.booked}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{stats.calls.reviewed}</dd>
            </div>
            <div>
              <dt>Playbook lines</dt>
              <dd>
                {stats.playbook.active}
                {stats.playbook.candidates > 0 && <span className="cue-model__cand"> +{stats.playbook.candidates}</span>}
              </dd>
            </div>
          </dl>
        </div>
      </header>
      <ul className="cue-model__tasks">
        {stats.tasks.map((t) => (
          <TaskRow key={t.task} t={t} />
        ))}
      </ul>
    </section>
  );
}
