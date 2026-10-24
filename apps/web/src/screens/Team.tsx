import { formatPercent, type CallSummary, type TeamMember, type TeamResponse } from '@cue/core';
import { Bar, Button, Chip, DataTable, EmptyState, ErrorState, Kpi, KpiStrip, Pane, SegmentedControl, Skeleton, Sprout, type Column } from '@cue/ui';
import { useState } from 'react';
import { useResource } from '../hooks/useResource';
import { hrefFor, navigate, replaceHash, useHashQuery } from '../router';
import { getApi } from '../state/api';
import { whenLabel } from '../state/contacts';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { openDebrief } from '../state/ui';
import { callStatus, type HistoryRange } from './History';

type View = 'you' | 'team';
type Range = '7d' | '30d' | '90d' | 'all';
const RANGES: { value: Range; label: string; days: number | null; words: string }[] = [
  { value: '7d', label: '7 days', days: 7, words: 'the last 7 days' },
  { value: '30d', label: '30 days', days: 30, words: 'the last 30 days' },
  { value: '90d', label: '90 days', days: 90, words: 'the last 90 days' },
  { value: 'all', label: 'All', days: null, words: 'all time' },
];
const isRange = (v: string | undefined): v is Range => RANGES.some((r) => r.value === v);
const WEEKS = 8;
const WEEK_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** History's closest range for a Team range (History has no 90-day view, so that shows everything). */
const historyRange = (r: Range): HistoryRange | undefined => (r === '7d' || r === '30d' ? r : undefined);

const pct = (n: number, d: number) => (d > 0 ? n / d : 0);
const pts = (a: number, b: number) => {
  const d = Math.round((a - b) * 100);
  return d === 0 ? 'level with' : `${Math.abs(d)} pts ${d > 0 ? 'above' : 'below'}`;
};

/** The most frequent items first ("Built rapport fast ×3"), case- and punctuation-insensitive. */
export function topThemes(lists: (string[] | undefined)[], max = 5): { text: string; count: number }[] {
  const seen = new Map<string, { text: string; count: number }>();
  for (const list of lists)
    for (const raw of list ?? []) {
      const text = raw.trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const cur = seen.get(key);
      if (cur) cur.count++;
      else seen.set(key, { text, count: 1 });
    }
  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

/**
 * How you're doing and how the team is doing: You compares your numbers with the team over the same
 * window, with your weekly trend and the themes from your reviews; Team is the board, one row per rep,
 * each opening History filtered to them. View and range live in the URL (`#/team?view=team&range=7d`).
 */
export function Team() {
  const hq = useHashQuery();
  const view: View = hq.view === 'team' ? 'team' : 'you';
  const range: Range = isRange(hq.range) ? hq.range : '30d';
  const set = (patch: Record<string, string | undefined>) => replaceHash(hrefFor({ name: 'team' }, { ...hq, ...patch }));
  const r = RANGES.find((x) => x.value === range)!;
  const [now] = useState(() => Date.now());
  const from = r.days ? now - r.days * 86_400_000 : undefined;
  const team = useResource((signal) => getApi().team({ ...(from !== undefined ? { from } : {}), weeks: WEEKS }, { signal }), [range], 60_000);
  // The trend always covers the last 8 weeks, whatever the range.
  const trend = useResource((signal) => getApi().team({ weeks: WEEKS }, { signal }), [], 60_000);

  return (
    <div className="web-team">
      <h1 className="web-sr">How you and the team are doing</h1>
      <div className="web-filterbar">
        <SegmentedControl<View>
          label="Show"
          showLabel
          size="sm"
          options={[
            { value: 'you', label: 'You' },
            { value: 'team', label: 'Team' },
          ]}
          value={view}
          onChange={(v) => set({ view: v === 'you' ? undefined : v })}
        />
        <span className="web-filterbar__field">
          <span className="cue-label" id="team-range">Period</span>
          <span className="cue-filter" role="group" aria-labelledby="team-range">
            {RANGES.map((x) => (
              <button key={x.value} type="button" aria-pressed={range === x.value} onClick={() => set({ range: x.value === '30d' ? undefined : x.value })}>
                {x.label}
              </button>
            ))}
          </span>
        </span>
        <span className="web-muted web-small">{view === 'you' ? `Your numbers next to the team's, ${r.words}.` : `Everyone on the team, ${r.words}. Pick a rep to see their calls.`}</span>
      </div>
      {team.error && !team.data ? (
        <div className="cue-dash-grid">
          <ErrorState title="Can't load the team's numbers" message={team.error.message} onRetry={team.reload} />
        </div>
      ) : view === 'you' ? (
        <You data={team.data} trend={trend.data} range={range} from={from} />
      ) : (
        <TeamBoard data={team.data} range={range} />
      )}
    </div>
  );
}

function KpiSkeleton({ labels }: { labels: string[] }) {
  return (
    <KpiStrip>
      {labels.map((l) => (
        <Kpi key={l} label={l} value={<Skeleton width="60%" height={26} />} />
      ))}
    </KpiStrip>
  );
}

function NoCalls({ who }: { who: 'you' | 'team' }) {
  return (
    <div className="cue-dash-grid">
      <Pane label={who === 'you' ? 'Your calls' : 'Team'} scroll={false}>
        <EmptyState
          art={<Sprout state="idle" size={72} />}
          title={who === 'you' ? 'No calls from you in this period' : 'No calls in this period'}
          action={
            <span className="web-chips">
              <Button variant="primary" icon="users" onClick={() => navigate({ name: 'contacts' })}>
                Pick someone to call
              </Button>
              <Button variant="secondary" icon="phone" onClick={() => navigate({ name: 'live' })}>
                Go to Live
              </Button>
            </span>
          }
        >
          {who === 'you'
            ? 'Make a call from Contacts or Live and save the debrief afterwards. Your booking rate, trend and what works for you build up here. Try a longer period if you called before.'
            : 'Once reps make calls, each one gets a row here with their bookings, how often they use the suggestions and how they rate their calls.'}
        </EmptyState>
      </Pane>
    </div>
  );
}

function You({ data, trend, range, from }: { data: TeamResponse | null; trend: TeamResponse | null; range: Range; from: number | undefined }) {
  const s = useStore(settingsStore);
  const repId = s.repId;
  const recent = useResource(
    (signal) => (repId ? getApi().listCalls({ repId, limit: 50, ...(from !== undefined ? { from } : {}) }, { signal }) : Promise.resolve([] as CallSummary[])),
    [repId, range],
    60_000,
  );

  if (!repId) {
    return (
      <div className="cue-dash-grid">
        <Pane label="You" scroll={false}>
          <EmptyState
            art={<Sprout state="idle" size={72} />}
            title="Tell Cue who you are"
            action={
              <Button variant="primary" icon="settings" onClick={() => navigate({ name: 'settings' })}>
                Set your name in Settings
              </Button>
            }
          >
            Your name marks the calls you make, so this page can show your own numbers next to the team&rsquo;s.
          </EmptyState>
        </Pane>
      </div>
    );
  }

  if (!data) return <KpiSkeleton labels={['Your booking rate', 'Calls', 'Suggestions used', 'Your call rating', 'Calls debriefed']} />;
  const t = data.totals;
  const me = data.members.find((m) => m.rep.id === repId);
  if (!me || me.calls === 0) return <NoCalls who="you" />;
  const reps = Math.max(1, t?.reps ?? data.members.length);
  const teamAvgCalls = t ? t.calls / reps : 0;
  const myUse = pct(me.cuesUsed, me.cuesShown);
  const teamUse = t ? pct(t.cuesUsed, t.cuesShown) : 0;
  const debriefed = me.debriefed ?? 0;
  const myTrend = trend?.members.find((m) => m.rep.id === repId)?.weekly ?? me.weekly ?? [];
  const calls = recent.data ?? [];
  const working = topThemes(calls.map((c) => c.wentWell));
  const fix = topThemes(calls.map((c) => c.wentBadly));
  const historyHref = hrefFor({ name: 'history' }, { rep: repId, range: historyRange(range) });

  return (
    <>
      <KpiStrip>
        <Kpi
          label="Your booking rate"
          value={me.connected ? formatPercent(me.bookingRate) : '—'}
          tone={t && me.connected ? (me.bookingRate >= t.bookingRate ? 'ok' : 'warn') : 'neutral'}
          note={me.connected ? `${me.booked} meetings from ${me.connected} calls answered. ${t ? `${cap(pts(me.bookingRate, t.bookingRate))} the team (${formatPercent(t.bookingRate)}).` : ''}` : 'Nobody has picked up yet in this period.'}
        />
        <Kpi label="Calls" value={me.calls} note={`${me.connected} picked up. The team averages ${teamAvgCalls.toFixed(teamAvgCalls < 10 ? 1 : 0)} per rep.`} />
        <Kpi
          label="Suggestions used"
          value={me.cuesShown ? formatPercent(myUse) : '—'}
          note={me.cuesShown ? `${me.cuesUsed} of ${me.cuesShown} lines Cue showed you. Team: ${formatPercent(teamUse)}.` : 'Cue hasn’t shown you a line yet.'}
        />
        <Kpi
          label="Your call rating"
          value={me.avgRating != null ? `${me.avgRating.toFixed(1)}/5` : '—'}
          note={me.avgRating != null ? `How you rated your calls in the debrief.${t?.avgRating != null ? ` Team: ${t.avgRating.toFixed(1)}.` : ''}` : 'Rate your calls in the debrief to see this.'}
        />
        <Kpi
          label="Calls debriefed"
          value={`${debriefed}/${me.calls}`}
          tone={debriefed < me.calls / 2 ? 'warn' : 'neutral'}
          note="Each debrief teaches Cue which lines work for you, so the suggestions get better."
        />
      </KpiStrip>
      <div className="cue-dash-grid web-team-grid">
        <Pane label="Your weekly trend" hint="Calls and meetings booked each week, you against the team's average per rep. Last 8 weeks." scroll={false} className="web-team-grid__trend">
          <WeeklyTrend mine={myTrend} team={trend ?? data} />
        </Pane>
        <Pane label="What's working for you" meta={working.length ? `from ${calls.length} calls` : undefined} hint="What went well on your recent calls, most frequent first. From your debriefs and Cue's reviews." scroll={false} className="web-team-grid__well">
          <Themes items={working} tone="ok" empty="Debrief a few calls and the things that keep working show up here." />
        </Pane>
        <Pane label="What to work on" meta={fix.length ? `from ${calls.length} calls` : undefined} hint="What didn't go well, most frequent first. Pick one to try differently on your next call." scroll={false} className="web-team-grid__fix">
          <Themes items={fix} tone="warn" empty="Nothing flagged yet. Debriefs and reviews fill this in." />
        </Pane>
        <Pane
          label="Your recent calls"
          meta={calls.length ? String(Math.min(calls.length, 6)) : undefined}
          hint="Open one to see its review, or see them all in History."
          scroll={false}
          pad="none"
          className="web-team-grid__recent"
          footer={
            <a className="cue-btn cue-btn--secondary cue-btn--sm" href={historyHref}>
              All your calls in History
            </a>
          }
        >
          {recent.error && !recent.data ? (
            <ErrorState compact message={recent.error.message} onRetry={recent.reload} className="web-pane-pad" />
          ) : !recent.data ? (
            <div className="web-pane-pad">
              <Skeleton lines={4} />
            </div>
          ) : calls.length === 0 ? (
            <p className="web-pane-pad web-muted web-small">No calls in this period.</p>
          ) : (
            <ul className="web-calllist web-calllist--flush">
              {calls.slice(0, 6).map((c) => {
                const st = callStatus(c);
                return (
                  <li key={c.id}>
                    <button type="button" className="web-calllist__item" onClick={() => openDebrief(c.id)}>
                      <span className="web-calllist__head">
                        <span className="web-hist-who__name">{c.prospect.name || c.prospect.company || 'Unnamed prospect'}</span>
                        <Chip size="sm" tone={st.tone}>
                          {st.label}
                        </Chip>
                      </span>
                      <span className="web-muted web-small">
                        <time dateTime={new Date(c.startedAt).toISOString()}>{whenLabel(c.startedAt)}</time>
                        {c.prospect.company && c.prospect.name ? ` · ${c.prospect.company}` : ''}
                        {c.rating != null ? ` · rated ${c.rating}/5` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Pane>
      </div>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Themes({ items, tone, empty }: { items: { text: string; count: number }[]; tone: 'ok' | 'warn'; empty: string }) {
  if (!items.length) return <p className="web-muted web-small">{empty}</p>;
  return (
    <ol className={`web-themes is-${tone}`}>
      {items.map((it) => (
        <li key={it.text} className="web-themes__item">
          <span className="web-themes__text">{it.text}</span>
          {it.count > 1 && <span className="web-themes__n" aria-label={`${it.count} calls`}>{`×${it.count}`}</span>}
        </li>
      ))}
    </ol>
  );
}

type Week = { weekStart: number; calls: number; booked: number };

/** The team's average per rep for each week (reps with any call in the 8 weeks). */
function teamWeekly(team: TeamResponse): Week[] {
  const active = team.members.filter((m) => (m.weekly ?? []).some((w) => w.calls > 0));
  const base = team.members[0]?.weekly ?? [];
  const n = Math.max(1, active.length);
  return base.map((w, i) => ({
    weekStart: w.weekStart,
    calls: active.reduce((s, m) => s + (m.weekly?.[i]?.calls ?? 0), 0) / n,
    booked: active.reduce((s, m) => s + (m.weekly?.[i]?.booked ?? 0), 0) / n,
  }));
}

/** Paired columns per week (you, team average) for calls and for meetings, with the same numbers as a table. */
function WeeklyTrend({ mine, team }: { mine: Week[]; team: TeamResponse }) {
  const avg = teamWeekly(team);
  if (!mine.length) return <p className="web-muted web-small">No weekly numbers yet.</p>;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const chart = (metric: 'calls' | 'booked', title: string) => {
    const max = Math.max(1, ...mine.map((w) => w[metric]), ...avg.map((w) => w[metric]));
    return (
      <figure className="web-trend" aria-label={title}>
        <figcaption className="cue-label">{title}</figcaption>
        <ol className="web-trend__cols">
          {mine.map((w, i) => {
            const t = avg[i]?.[metric] ?? 0;
            return (
              <li key={w.weekStart} className="web-trend__week">
                <span className="web-trend__pair" aria-hidden>
                  <span className="web-trend__bar is-you" style={{ transform: `scaleY(${(w[metric] / max).toFixed(3)})` }} />
                  <span className="web-trend__bar is-team" style={{ transform: `scaleY(${(t / max).toFixed(3)})` }} />
                </span>
                <span className="cue-vh">{`Week of ${WEEK_FMT.format(w.weekStart)}: you ${fmt(w[metric])}, team average ${fmt(t)}`}</span>
              </li>
            );
          })}
        </ol>
        <span className="web-trend__axis" aria-hidden>
          <span>{WEEK_FMT.format(mine[0]!.weekStart)}</span>
          <span>{`peak ${fmt(max)}`}</span>
          <span>This week</span>
        </span>
      </figure>
    );
  };
  return (
    <div className="web-stack">
      <span className="web-trend__legend" aria-hidden>
        <span>
          <span className="web-trend__key is-you" /> You
        </span>
        <span>
          <span className="web-trend__key is-team" /> Team average
        </span>
      </span>
      <div className="web-trend__charts">
        {chart('calls', 'Calls per week')}
        {chart('booked', 'Meetings booked per week')}
      </div>
      <details className="web-disclose">
        <summary>Show as a table</summary>
        <div className="cue-table-wrap" role="region" aria-label="Weekly numbers" tabIndex={0}>
          <table className="cue-table" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col" className="is-end">Your calls</th>
                <th scope="col" className="is-end">Team avg calls</th>
                <th scope="col" className="is-end">Your meetings</th>
                <th scope="col" className="is-end">Team avg meetings</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((w, i) => (
                <tr key={w.weekStart}>
                  <td className="is-mono">{WEEK_FMT.format(w.weekStart)}</td>
                  <td className="is-mono is-end">{w.calls}</td>
                  <td className="is-mono is-end">{fmt(avg[i]?.calls ?? 0)}</td>
                  <td className="is-mono is-end">{w.booked}</td>
                  <td className="is-mono is-end">{fmt(avg[i]?.booked ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function TeamBoard({ data, range }: { data: TeamResponse | null; range: Range }) {
  const repId = useStore(settingsStore, (s) => s.repId);
  if (!data) return <KpiSkeleton labels={['Reps', 'Calls', 'Booking rate', 'Suggestions used', 'Calls debriefed']} />;
  const t = data.totals;
  if (!t || t.calls === 0 || data.members.length === 0) return <NoCalls who="team" />;
  const open = (m: TeamMember) => navigate({ name: 'history' }, { rep: m.rep.id, range: historyRange(range) });
  const best = Math.max(...data.members.map((m) => m.bookingRate));

  const columns: Column<TeamMember>[] = [
    {
      key: 'rep',
      header: 'Rep',
      render: (m) => (
        <span className="web-hist-who">
          <span className="web-hist-who__name">
            {m.rep.name || m.rep.id}
            {m.rep.id === repId && <span className="web-muted web-small"> (you)</span>}
          </span>
          {m.lastCallAt && <span className="web-muted web-small">{`Last call ${whenLabel(m.lastCallAt)}`}</span>}
        </span>
      ),
    },
    { key: 'calls', header: 'Calls', width: '64px', mono: true, align: 'end', render: (m) => m.calls },
    { key: 'connected', header: 'Answered', width: '84px', mono: true, align: 'end', render: (m) => m.connected },
    { key: 'booked', header: 'Booked', width: '72px', mono: true, align: 'end', render: (m) => m.booked },
    { key: 'rate', header: 'Booking rate', width: '170px', render: (m) => (m.connected ? <Bar value={m.bookingRate} label={formatPercent(m.bookingRate)} tone={m.bookingRate === best && best > 0 ? 'ok' : 'accent'} /> : <span className="web-muted">—</span>) },
    { key: 'used', header: 'Suggestions used', width: '128px', mono: true, align: 'end', render: (m) => (m.cuesShown ? formatPercent(pct(m.cuesUsed, m.cuesShown)) : '—') },
    { key: 'rating', header: 'Avg rating', width: '100px', mono: true, align: 'end', render: (m) => (m.avgRating != null ? `${m.avgRating.toFixed(1)}/5` : '—') },
    { key: 'debriefed', header: 'Debriefed', width: '108px', mono: true, align: 'end', render: (m) => `${m.debriefed ?? 0}/${m.calls}` },
  ];

  return (
    <>
      <KpiStrip>
        <Kpi label="Reps" value={t.reps} note="People who made at least one call in this period." />
        <Kpi label="Calls" value={t.calls} note={`${t.connected} answered by someone.`} />
        <Kpi label="Booking rate" value={t.connected ? formatPercent(t.bookingRate) : '—'} note={`${t.booked} meetings booked from ${t.connected} answered calls.`} tone={t.booked > 0 ? 'ok' : 'neutral'} />
        <Kpi label="Suggestions used" value={t.cuesShown ? formatPercent(pct(t.cuesUsed, t.cuesShown)) : '—'} note={`${t.cuesUsed} of ${t.cuesShown} lines Cue showed were said.`} />
        <Kpi label="Calls debriefed" value={`${t.debriefed}/${t.calls}`} note={`Debriefs teach Cue what works.${t.avgRating != null ? ` Average rating ${t.avgRating.toFixed(1)}/5.` : ''}`} tone={t.debriefed < t.calls / 2 ? 'warn' : 'neutral'} />
      </KpiStrip>
      <div className="cue-dash-grid">
        <Pane label="Leaderboard" meta={`${data.members.length} reps`} hint="Ranked by meetings booked. Booking rate counts only calls someone answered. Pick a rep to see their calls in History." pad="none" scroll={false}>
          <DataTable label="Team leaderboard" columns={columns} rows={data.members} rowKey={(m) => m.rep.id} onSelect={open} minWidth={860} />
        </Pane>
      </div>
    </>
  );
}
