import { formatPercent, type CallSummary, type TeamMember, type TeamResponse } from '@cue/core';
import { Bar, Board, BoardSection, Button, Chip, DataTable, EmptyState, ErrorState, Kpi, KpiStrip, Pane, SegmentedControl, Skeleton, Sprout, Toolbar, type Column } from '@cue/ui';
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
      <Toolbar label="Team filters">
        <SegmentedControl<View>
          label="Show"
          size="sm"
          options={[
            { value: 'you', label: 'You' },
            { value: 'team', label: 'Team' },
          ]}
          value={view}
          onChange={(v) => set({ view: v === 'you' ? undefined : v })}
        />
        <span className="cue-label" id="team-range">
          Period
        </span>
        <span className="cue-filter" role="group" aria-labelledby="team-range">
          {RANGES.map((x) => (
            <button key={x.value} type="button" aria-pressed={range === x.value} onClick={() => set({ range: x.value === '30d' ? undefined : x.value })}>
              {x.label}
            </button>
          ))}
        </span>
        <span className="web-muted web-small web-toolbar__note">{view === 'you' ? `Your numbers next to the team's, ${r.words}.` : `Everyone on the team, ${r.words}. Pick a rep to see their calls.`}</span>
      </Toolbar>
      <Board>
        {team.error && !team.data ? (
          <ErrorState title="Can't load the team's numbers" message={team.error.message} onRetry={team.reload} />
        ) : view === 'you' ? (
          <You data={team.data} trend={trend.data} range={range} from={from} />
        ) : (
          <TeamBoard data={team.data} trend={trend.data} range={range} from={from} />
        )}
      </Board>
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
    <Pane label={who === 'you' ? 'Your calls' : 'Team'} scroll={false} span={12}>
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
      <Pane label="You" scroll={false} span={12}>
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
      <BoardSection title="Your trend" hint="Calls and meetings booked each week for the last 8 weeks, you against the team's average per rep.">
        <Pane label="Weekly" span={12} scroll={false}>
          <WeeklyTrend mine={myTrend} avg={teamWeekly(trend ?? data)} labels={['You', 'Team average']} />
        </Pane>
      </BoardSection>
      <BoardSection title="Coaching" hint={`From your debriefs and Cue's reviews of your last ${calls.length} ${calls.length === 1 ? 'call' : 'calls'}, most frequent first.`}>
        <Pane label="What's working for you" meta={working.length ? `${working.length} themes` : undefined} span={6} scroll={false}>
          <Themes items={working} tone="ok" empty="Debrief a few calls and the things that keep working show up here." />
        </Pane>
        <Pane label="What to work on" meta={fix.length ? `${fix.length} themes` : undefined} span={6} scroll={false}>
          <Themes items={fix} tone="warn" empty="Nothing flagged yet. Debriefs and reviews fill this in." />
        </Pane>
      </BoardSection>
      <BoardSection
        title="Your recent calls"
        hint="Open one to see its review and debrief."
        actions={
          <a className="cue-btn cue-btn--secondary cue-btn--sm" href={historyHref}>
            All your calls in History
          </a>
        }
      >
        <Pane label="Recent calls" meta={calls.length ? String(calls.length) : undefined} span={12} scroll="cap" pad="none">
          {recent.error && !recent.data ? (
            <ErrorState compact message={recent.error.message} onRetry={recent.reload} className="web-pane-pad" />
          ) : !recent.data ? (
            <div className="web-pane-pad">
              <Skeleton lines={4} />
            </div>
          ) : (
            <CallsTable calls={calls} />
          )}
        </Pane>
      </BoardSection>
    </>
  );
}

const CALL_COLUMNS: Column<CallSummary>[] = [
  {
    key: 'who',
    header: 'Prospect',
    render: (c) => (
      <span className="web-hist-who">
        <span className="web-hist-who__name">{c.prospect.name || c.prospect.company || 'Unnamed prospect'}</span>
        <span className="web-muted web-small">{[c.prospect.title, c.prospect.company].filter(Boolean).join(' · ')}</span>
      </span>
    ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    width: '200px',
    render: (c) => {
      const st = callStatus(c);
      return (
        <Chip size="sm" tone={st.tone}>
          {st.label}
        </Chip>
      );
    },
  },
  { key: 'rating', header: 'Rating', width: '80px', mono: true, align: 'end', render: (c) => (c.rating != null ? `${c.rating}/5` : '—') },
  { key: 'used', header: 'Suggestions used', width: '140px', mono: true, align: 'end', render: (c) => `${c.used}/${c.suggestions}` },
  { key: 'when', header: 'When', width: '170px', render: (c) => <time dateTime={new Date(c.startedAt).toISOString()}>{whenLabel(c.startedAt)}</time> },
];

function CallsTable({ calls }: { calls: CallSummary[] }) {
  return (
    <DataTable
      label="Recent calls"
      columns={CALL_COLUMNS}
      rows={calls}
      rowKey={(c) => c.id}
      onSelect={(c) => openDebrief(c.id)}
      minWidth={680}
      empty={<p className="web-pane-pad web-muted web-small">No calls in this period.</p>}
    />
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

/** Paired columns per week (series A, series B) for calls and for meetings, each week labelled, with the numbers as a table. */
function WeeklyTrend({ mine, avg, labels }: { mine: Week[]; avg: Week[]; labels: [string, string] }) {
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
            const last = i === mine.length - 1;
            return (
              <li key={w.weekStart} className="web-trend__week">
                <span className="web-trend__vals" aria-hidden>
                  <span className="is-you">{w[metric] ? fmt(w[metric]) : ''}</span>
                  <span className="is-team">{t ? fmt(t) : ''}</span>
                </span>
                <span className="web-trend__pair" aria-hidden>
                  <span className="web-trend__bar is-you" style={{ transform: `scaleY(${(w[metric] / max).toFixed(3)})` }} />
                  <span className="web-trend__bar is-team" style={{ transform: `scaleY(${(t / max).toFixed(3)})` }} />
                </span>
                <span className="web-trend__wk" aria-hidden>
                  {last ? 'This week' : WEEK_FMT.format(w.weekStart)}
                </span>
                <span className="cue-vh">{`Week of ${WEEK_FMT.format(w.weekStart)}: ${labels[0]} ${fmt(w[metric])}, ${labels[1]} ${fmt(t)}`}</span>
              </li>
            );
          })}
        </ol>
      </figure>
    );
  };
  return (
    <div className="web-stack">
      <span className="web-trend__legend" aria-hidden>
        <span>
          <span className="web-trend__key is-you" /> {labels[0]}
        </span>
        <span>
          <span className="web-trend__key is-team" /> {labels[1]}
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
                <th scope="col" className="is-end">{`${labels[0]}: calls`}</th>
                <th scope="col" className="is-end">{`${labels[1]}: calls`}</th>
                <th scope="col" className="is-end">{`${labels[0]}: meetings`}</th>
                <th scope="col" className="is-end">{`${labels[1]}: meetings`}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((w, i) => (
                <tr key={w.weekStart}>
                  <td className="is-mono">{WEEK_FMT.format(w.weekStart)}</td>
                  <td className="is-mono is-end">{fmt(w.calls)}</td>
                  <td className="is-mono is-end">{fmt(avg[i]?.calls ?? 0)}</td>
                  <td className="is-mono is-end">{fmt(w.booked)}</td>
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

/** The whole team's calls and meetings per week. */
function teamTotals(team: TeamResponse): Week[] {
  const base = team.members[0]?.weekly ?? [];
  return base.map((w, i) => ({
    weekStart: w.weekStart,
    calls: team.members.reduce((s, m) => s + (m.weekly?.[i]?.calls ?? 0), 0),
    booked: team.members.reduce((s, m) => s + (m.weekly?.[i]?.booked ?? 0), 0),
  }));
}

function TeamBoard({ data, trend, range, from }: { data: TeamResponse | null; trend: TeamResponse | null; range: Range; from: number | undefined }) {
  const repId = useStore(settingsStore, (s) => s.repId);
  const recent = useResource((signal) => getApi().listCalls({ limit: 100, ...(from !== undefined ? { from } : {}) }, { signal }), [range], 60_000);
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
      <BoardSection title="Leaderboard" hint="Ranked by meetings booked. Booking rate counts only calls someone answered. Pick a rep to see their calls in History.">
        <Pane label="Reps" meta={`${data.members.length} reps`} pad="none" span={12} scroll={false}>
          <DataTable label="Team leaderboard" columns={columns} rows={data.members} rowKey={(m) => m.rep.id} onSelect={open} minWidth={860} />
        </Pane>
      </BoardSection>
      <BoardSection title="Team trend" hint="The whole team's calls and meetings each week for the last 8 weeks, with the average per rep.">
        <Pane label="Weekly" span={12} scroll={false}>
          <WeeklyTrend mine={teamTotals(trend ?? data)} avg={teamWeekly(trend ?? data)} labels={['Team total', 'Average per rep']} />
        </Pane>
      </BoardSection>
      <BoardSection title="What the team is learning" hint={`Themes from the debriefs and reviews of the team's last ${(recent.data ?? []).length} calls, most frequent first. These are the labels Mubit trains on.`}>
        <Pane label="What's working" span={6} scroll={false}>
          {recent.data ? <Themes items={topThemes(recent.data.map((c) => c.wentWell), 8)} tone="ok" empty="Debriefs fill this in." /> : <Skeleton lines={4} />}
        </Pane>
        <Pane label="What isn't" span={6} scroll={false}>
          {recent.data ? <Themes items={topThemes(recent.data.map((c) => c.wentBadly), 8)} tone="warn" empty="Nothing flagged yet." /> : <Skeleton lines={4} />}
        </Pane>
      </BoardSection>
    </>
  );
}
