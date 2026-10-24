import { formatPercent, type CallSummary, type TeamMember, type TeamResponse } from '@cue/core';
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
  Pane,
  SegmentedControl,
  Skeleton,
  Sprout,
  Toolbar,
  Workspace,
  type Column,
} from '@cue/ui';
import { useEffect, useState } from 'react';
import { useResource } from '../hooks/useResource';
import { hrefFor, navigate, replaceHash, useHashQuery } from '../router';
import { getApi } from '../state/api';
import { whenLabel } from '../state/contacts';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { openDebrief } from '../state/ui';
import { callStatus, type HistoryRange } from './History';
import '../styles/screens/team.css';

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
const fmtRating = (n: number | null | undefined) => (n != null ? `${n.toFixed(1)}/5` : '—');
const repName = (m: { rep: { id: string; name: string } }) => m.rep.name || m.rep.id;
const firstName = (name: string) => name.split(/\s+/)[0] || name;

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

type ThemeTab = 'good' | 'bad';
type BoardTab = 'reps' | 'trend';

/**
 * How you and the team are doing. Rail: the reps. You view: one rep's numbers against the team, their
 * weekly trend and coaching themes, their calls in the drawer. Team view: the leaderboard and what the
 * team is learning, with the chosen rep in the drawer. View, period and rep live in the URL
 * (`#/team?view=team&range=7d&rep=rep_sam`); with no rep it's you.
 */
export function Team() {
  const hq = useHashQuery();
  const me = useStore(settingsStore, (s) => s.repId);
  const view: View = hq.view === 'team' ? 'team' : 'you';
  const range: Range = isRange(hq.range) ? hq.range : '30d';
  const rep = hq.rep || me;
  const isMe = !!rep && rep === me;
  const set = (patch: Record<string, string | undefined>) => replaceHash(hrefFor({ name: 'team' }, { ...hq, ...patch }));
  const pickRep = (id: string, v: View = view) => set({ rep: id === me ? undefined : id, view: v === 'you' ? undefined : v });
  const r = RANGES.find((x) => x.value === range)!;
  const [now] = useState(() => Date.now());
  const from = r.days ? now - r.days * 86_400_000 : undefined;
  const team = useResource((signal) => getApi().team({ ...(from !== undefined ? { from } : {}), weeks: WEEKS }, { signal }), [range], 60_000);
  // The trend always covers the last 8 weeks, whatever the range.
  const trend = useResource((signal) => getApi().team({ weeks: WEEKS }, { signal }), [], 60_000);
  const repCalls = useResource(
    (signal) => (rep ? getApi().listCalls({ repId: rep, limit: 50, ...(from !== undefined ? { from } : {}) }, { signal }) : Promise.resolve([] as CallSummary[])),
    [rep, range],
    60_000,
  );
  const allCalls = useResource((signal) => (view === 'team' ? getApi().listCalls({ limit: 100, ...(from !== undefined ? { from } : {}) }, { signal }) : Promise.resolve(null)), [view, range], 60_000);

  const d = team.data;
  const members = d?.members ?? [];
  const chosen = members.find((m) => m.rep.id === rep) ?? null;
  const name = chosen ? repName(chosen) : rep === me ? 'You' : rep;
  const youLabel = isMe || !rep ? 'You' : name;

  return (
    <div className="web-screen web-team">
      <h1 className="web-sr">How you and the team are doing</h1>
      <Toolbar label="Team filters">
        <SegmentedControl<View>
          label="Show"
          size="sm"
          options={[
            { value: 'you', label: youLabel },
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
        <span className="web-muted web-small web-toolbar__note">
          {view === 'you' ? `${isMe ? 'Your' : `${firstName(name)}'s`} numbers next to the team's, ${r.words}.` : `Everyone on the team, ${r.words}. Pick a rep to see their calls.`}
        </span>
      </Toolbar>
      <Workspace
        storageKey="team"
        rail={{
          label: 'People',
          summary: view === 'you' ? youLabel : `${members.length} reps`,
          count: members.length || undefined,
          children: <People members={members} loading={!d} me={me} rep={rep} onPick={(id) => pickRep(id, 'you')} />,
        }}
        drawer={{
          label: view === 'you' ? 'Calls' : 'Rep',
          summary: view === 'you' ? `${repCalls.data?.length ?? 0} calls` : name,
          children:
            view === 'you' ? (
              <RepCalls calls={repCalls.data} error={repCalls.error} reload={repCalls.reload} historyHref={rep ? hrefFor({ name: 'history' }, { rep, range: historyRange(range) }) : null} who={isMe ? 'you' : firstName(name)} />
            ) : (
              <RepDrawer member={chosen} me={me} calls={repCalls.data} historyHref={rep ? hrefFor({ name: 'history' }, { rep, range: historyRange(range) }) : null} onOpen={() => rep && pickRep(rep, 'you')} />
            ),
        }}
      >
        {team.error && !d ? (
          <ErrorState title="Can't load the team's numbers" message={team.error.message} onRetry={team.reload} />
        ) : view === 'you' ? (
          <You data={d} trend={trend.data} rep={rep} isMe={isMe} name={name} calls={repCalls.data} />
        ) : (
          <TeamView data={d} trend={trend.data} calls={allCalls.data} me={me} rep={rep} onPick={(id) => pickRep(id)} />
        )}
      </Workspace>
    </div>
  );
}

function People({ members, loading, me, rep, onPick }: { members: TeamMember[]; loading: boolean; me: string; rep: string; onPick: (id: string) => void }) {
  const sorted = [...members].sort((a, b) => (a.rep.id === me ? -1 : b.rep.id === me ? 1 : b.calls - a.calls));
  return (
    <Pane label="People" side="rail" pad="none" as="nav" hint="Pick a rep to see their numbers and calls.">
      {loading ? (
        <div className="web-pad">
          <Skeleton lines={5} />
        </div>
      ) : sorted.length === 0 ? (
        <p className="web-muted web-small web-pad">Nobody has made a call in this period.</p>
      ) : (
        <div className="cue-index">
          {sorted.map((m) => (
            <button key={m.rep.id} type="button" className="cue-index__item web-team-rep" aria-pressed={m.rep.id === rep} onClick={() => onPick(m.rep.id)}>
              <span className="cue-index__key" aria-hidden />
              <span className="cue-index__name">
                {repName(m)}
                {m.rep.id === me && <span className="web-muted"> (you)</span>}
              </span>
              <span className="cue-index__fig" aria-label={`${m.calls} calls`}>
                {m.calls}
              </span>
              <span className="cue-index__sub">{m.lastCallAt ? `Last call ${whenLabel(m.lastCallAt)}` : 'No calls yet'}</span>
            </button>
          ))}
        </div>
      )}
    </Pane>
  );
}

function KpiSkeleton({ labels }: { labels: string[] }) {
  return (
    <KpiStrip>
      {labels.map((l) => (
        <Kpi key={l} label={l} value={<Skeleton width="60%" height={24} />} />
      ))}
    </KpiStrip>
  );
}

function NoCalls({ who }: { who: 'you' | 'someone' | 'team' }) {
  return (
    <Pane label={who === 'team' ? 'Team' : 'Calls'}>
      <EmptyState
        art={<Sprout state="idle" size={64} />}
        title={who === 'you' ? 'No calls from you in this period' : who === 'someone' ? 'No calls from this rep in this period' : 'No calls in this period'}
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
        {who === 'team'
          ? 'Once reps make calls, each one gets a row here with their bookings, suggestions used and ratings.'
          : 'Make a call from Contacts or Live and save the debrief. Booking rate, trend and coaching build up here. Try a longer period.'}
      </EmptyState>
    </Pane>
  );
}

function You({ data, trend, rep, isMe, name, calls }: { data: TeamResponse | null; trend: TeamResponse | null; rep: string; isMe: boolean; name: string; calls: CallSummary[] | null }) {
  const [tab, setTab] = useState<ThemeTab>('good');
  if (!rep) {
    return (
      <Pane label="You">
        <EmptyState
          art={<Sprout state="idle" size={64} />}
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
  if (!data) return <KpiSkeleton labels={['Booking rate', 'Calls', 'Lines used', 'Call rating', 'Debriefed']} />;
  const t = data.totals;
  const m = data.members.find((x) => x.rep.id === rep);
  if (!m || m.calls === 0) return <NoCalls who={isMe ? 'you' : 'someone'} />;
  const reps = Math.max(1, t?.reps ?? data.members.length);
  const teamAvgCalls = t ? t.calls / reps : 0;
  const use = pct(m.cuesUsed, m.cuesShown);
  const teamUse = t ? pct(t.cuesUsed, t.cuesShown) : 0;
  const debriefed = m.debriefed ?? 0;
  const weekly = trend?.members.find((x) => x.rep.id === rep)?.weekly ?? m.weekly ?? [];
  const list = calls ?? [];
  const working = topThemes(list.map((c) => c.wentWell));
  const fix = topThemes(list.map((c) => c.wentBadly));
  const who = isMe ? 'You' : firstName(name);
  const lastWeek = weekly.at(-1);

  return (
    <>
      <KpiStrip foldId="kpis">
        <Kpi
          label="Booking rate"
          value={m.connected ? formatPercent(m.bookingRate) : '—'}
          tone={t && m.connected ? (m.bookingRate >= t.bookingRate ? 'ok' : 'warn') : 'neutral'}
          note={m.connected ? `team ${t ? formatPercent(t.bookingRate) : '—'}` : 'none answered'}
        />
        <Kpi label="Calls" value={m.calls} note={`team avg ${teamAvgCalls.toFixed(teamAvgCalls < 10 ? 1 : 0)}`} />
        <Kpi label="Lines used" value={m.cuesShown ? formatPercent(use) : '—'} note={m.cuesShown ? `team ${formatPercent(teamUse)}` : 'none shown'} />
        <Kpi label="Call rating" value={fmtRating(m.avgRating)} note={m.avgRating != null ? `team ${fmtRating(t?.avgRating)}` : 'not rated yet'} />
        <Kpi label="Debriefed" value={`${debriefed}/${m.calls}`} tone={debriefed < m.calls / 2 ? 'warn' : 'neutral'} note={`team ${t ? `${t.debriefed}/${t.calls}` : '—'}`} />
      </KpiStrip>
      <Pane
        paneId="trend"
        label="Weekly trend"
        grow={1.2}
        meta="last 8 weeks"
        summary={lastWeek ? `this week ${lastWeek.calls} calls · ${lastWeek.booked} booked` : undefined}
        hint={`Calls and meetings each week, ${isMe ? 'you' : firstName(name)} against the team's average per rep.`}
      >
        <WeeklyTrend mine={weekly} avg={teamWeekly(trend ?? data)} labels={[who, 'Team average']} />
      </Pane>
      <Pane
        paneId="coaching"
        label="Coaching"
        pad="none"
        summary={`${working.length} working · ${fix.length} to work on`}
        tabs={[
          { id: 'good', label: "What's working", count: working.length },
          { id: 'bad', label: 'What to work on', count: fix.length },
        ]}
        tab={tab}
        onTab={(x) => setTab(x as ThemeTab)}
      >
        <p className="cue-hint web-team-note">{`From debriefs and reviews of ${isMe ? 'your' : `${firstName(name)}'s`} last ${list.length} ${list.length === 1 ? 'call' : 'calls'}, most frequent first.`}</p>
        {!calls ? (
          <div className="web-pad">
            <Skeleton lines={4} />
          </div>
        ) : tab === 'good' ? (
          <Themes items={working} tone="ok" empty="Debrief a few calls and the things that keep working show up here." />
        ) : (
          <Themes items={fix} tone="warn" empty="Nothing flagged yet. Debriefs and reviews fill this in." />
        )}
      </Pane>
    </>
  );
}

const SHORT_CALL_COLS: Column<CallSummary>[] = [
  { key: 'who', header: 'Prospect', render: (c) => <span className="web-team-who">{c.prospect.name || c.prospect.company || 'Unnamed prospect'}</span> },
  {
    key: 'outcome',
    header: 'Outcome',
    width: '150px',
    render: (c) => {
      const st = callStatus(c);
      return (
        <Chip size="sm" tone={st.tone}>
          {st.label}
        </Chip>
      );
    },
  },
  { key: 'when', header: 'When', width: '96px', mono: true, render: (c) => <time dateTime={new Date(c.startedAt).toISOString()}>{shortWhen(c.startedAt)}</time> },
];

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const SHORT_TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "14:05" today, "Oct 22" before. */
function shortWhen(t: number): string {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? SHORT_TIME.format(d) : SHORT_DAY.format(d);
}

/** You view drawer: the rep's calls, with the picked one in full below. */
function RepCalls({ calls, error, reload, historyHref, who }: { calls: CallSummary[] | null; error: Error | null; reload: () => void; historyHref: string | null; who: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = calls ?? [];
  useEffect(() => {
    if (rows.length && !rows.some((c) => c.id === selected)) setSelected(rows[0]!.id);
  }, [rows, selected]);
  const current = rows.find((c) => c.id === selected) ?? null;
  return (
    <Pane
      label="Calls"
      side="drawer"
      pad="none"
      as="aside"
      meta={calls ? String(rows.length) : undefined}
      actions={
        historyHref && (
          <a className="cue-btn cue-btn--ghost cue-btn--sm" href={historyHref}>
            In History
          </a>
        )
      }
    >
      <div className="web-split">
        <div className="web-split__top">
          {error && !calls ? (
            <div className="web-pad">
              <ErrorState compact title="Can't load the calls" message={error.message} onRetry={reload} />
            </div>
          ) : !calls ? (
            <div className="web-pad">
              <Skeleton lines={6} />
            </div>
          ) : (
            <DataTable
              label={`${who === 'you' ? 'Your' : `${who}'s`} recent calls`}
              columns={SHORT_CALL_COLS}
              rows={rows}
              rowKey={(c) => c.id}
              selectedKey={current?.id}
              onSelect={(c) => setSelected(c.id)}
              minWidth={320}
              empty={
                <EmptyState compact title="No calls in this period">
                  Calls show up here once they end. Try a longer period.
                </EmptyState>
              }
            />
          )}
        </div>
        <div className="web-split__bottom">
          <CallDetail call={current} />
        </div>
      </div>
    </Pane>
  );
}

function CallDetail({ call }: { call: CallSummary | null }) {
  if (!call) return <p className="web-muted web-small web-pad">Pick a call to see its review.</p>;
  const st = callStatus(call);
  const reviewed = call.status === 'reviewed' || call.rating != null || !!call.reviewSummary;
  return (
    <section aria-label="Call detail" className="web-team-call">
      <div className="web-pad web-pad--tight web-team-call__head">
        <span className="cue-label">{call.prospect.name || call.prospect.company || 'Unnamed prospect'}</span>
        <Button size="sm" variant={reviewed ? 'secondary' : 'primary'} onClick={() => openDebrief(call.id)}>
          {reviewed ? 'See the review' : 'Debrief'}
        </Button>
      </div>
      <KeyValue
        className="web-kv-inset"
        items={[
          { label: 'Who', value: [call.prospect.title, call.prospect.company].filter(Boolean).join(' · ') || '—' },
          {
            label: 'Outcome',
            value: (
              <Chip size="sm" tone={st.tone}>
                {st.label}
              </Chip>
            ),
          },
          { label: 'When', value: <span className="web-nowrap">{whenLabel(call.startedAt)}</span> },
          { label: 'Rating', value: <span className="cue-num">{call.rating != null ? `${call.rating}/5` : '—'}</span> },
          { label: 'Suggestions', value: <span className="cue-num">{`${call.used} used of ${call.suggestions}`}</span> },
        ]}
      />
      {call.reviewSummary && <p className="web-team-call__summary">{call.reviewSummary}</p>}
      {!!call.wentWell?.length && (
        <>
          <div className="web-pad web-pad--tight">
            <span className="cue-label">Went well</span>
          </div>
          <Themes items={call.wentWell.map((text) => ({ text, count: 1 }))} tone="ok" empty="" />
        </>
      )}
      {!!call.wentBadly?.length && (
        <>
          <div className="web-pad web-pad--tight">
            <span className="cue-label">Didn&rsquo;t go well</span>
          </div>
          <Themes items={call.wentBadly.map((text) => ({ text, count: 1 }))} tone="warn" empty="" />
        </>
      )}
      {!reviewed && !call.wentWell?.length && <p className="web-muted web-small web-pad">Not debriefed yet. A debrief tells Cue which lines worked.</p>}
    </section>
  );
}

function Themes({ items, tone, empty }: { items: { text: string; count: number }[]; tone: 'ok' | 'warn'; empty: string }) {
  if (!items.length) return empty ? <p className="web-muted web-small web-pad">{empty}</p> : null;
  return (
    <ol className={`web-themes web-team-themes is-${tone}`}>
      {items.map((it, i) => (
        <li key={`${i}-${it.text}`} className="web-themes__item">
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

/** The whole team's calls and meetings per week. */
function teamTotals(team: TeamResponse): Week[] {
  const base = team.members[0]?.weekly ?? [];
  return base.map((w, i) => ({
    weekStart: w.weekStart,
    calls: team.members.reduce((s, m) => s + (m.weekly?.[i]?.calls ?? 0), 0),
    booked: team.members.reduce((s, m) => s + (m.weekly?.[i]?.booked ?? 0), 0),
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
                  {last ? 'Now' : WEEK_FMT.format(w.weekStart)}
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
    <div className="web-team-trend">
      <div className="web-team-trend__bar">
        <span className="web-trend__legend" aria-hidden>
          <span>
            <span className="web-trend__key is-you" /> {labels[0]}
          </span>
          <span>
            <span className="web-trend__key is-team" /> {labels[1]}
          </span>
        </span>
      </div>
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

function TeamView({ data, trend, calls, me, rep, onPick }: { data: TeamResponse | null; trend: TeamResponse | null; calls: CallSummary[] | null; me: string; rep: string; onPick: (id: string) => void }) {
  const [boardTab, setBoardTab] = useState<BoardTab>('reps');
  const [learnTab, setLearnTab] = useState<ThemeTab>('good');
  if (!data) return <KpiSkeleton labels={['Reps', 'Calls', 'Booking rate', 'Lines used', 'Debriefed']} />;
  const t = data.totals;
  if (!t || t.calls === 0 || data.members.length === 0) return <NoCalls who="team" />;
  const best = Math.max(...data.members.map((m) => m.bookingRate));
  const leader = [...data.members].sort((a, b) => b.booked - a.booked)[0];
  const good = calls ? topThemes(calls.map((c) => c.wentWell), 8) : [];
  const bad = calls ? topThemes(calls.map((c) => c.wentBadly), 8) : [];

  const columns: Column<TeamMember>[] = [
    {
      key: 'rep',
      header: 'Rep',
      render: (m) => (
        <span className="web-team-who">
          {repName(m)}
          {m.rep.id === me && <span className="web-muted web-small"> (you)</span>}
        </span>
      ),
    },
    { key: 'calls', header: 'Calls', width: '60px', mono: true, align: 'end', render: (m) => m.calls },
    { key: 'connected', header: 'Answered', width: '84px', mono: true, align: 'end', render: (m) => m.connected },
    { key: 'booked', header: 'Booked', width: '68px', mono: true, align: 'end', render: (m) => m.booked },
    { key: 'rate', header: 'Booking rate', width: '128px', render: (m) => (m.connected ? <Bar value={m.bookingRate} label={formatPercent(m.bookingRate)} tone={m.bookingRate === best && best > 0 ? 'ok' : 'accent'} /> : <span className="web-muted">—</span>) },
    { key: 'used', header: 'Used', width: '58px', mono: true, align: 'end', render: (m) => (m.cuesShown ? formatPercent(pct(m.cuesUsed, m.cuesShown)) : '—') },
    { key: 'rating', header: 'Rating', width: '64px', mono: true, align: 'end', render: (m) => fmtRating(m.avgRating) },
    { key: 'debriefed', header: 'Debriefed', width: '88px', mono: true, align: 'end', render: (m) => `${m.debriefed ?? 0}/${m.calls}` },
  ];

  return (
    <>
      <KpiStrip foldId="kpis">
        <Kpi label="Reps" value={t.reps} note="made a call" />
        <Kpi label="Calls" value={t.calls} note={`${t.connected} answered`} />
        <Kpi label="Booking rate" value={t.connected ? formatPercent(t.bookingRate) : '—'} note={`${t.booked} of ${t.connected}`} tone={t.booked > 0 ? 'ok' : 'neutral'} />
        <Kpi label="Lines used" value={t.cuesShown ? formatPercent(pct(t.cuesUsed, t.cuesShown)) : '—'} note={`${t.cuesUsed} of ${t.cuesShown}`} />
        <Kpi label="Debriefed" value={`${t.debriefed}/${t.calls}`} note={t.avgRating != null ? `rated ${t.avgRating.toFixed(1)}/5` : 'none rated'} tone={t.debriefed < t.calls / 2 ? 'warn' : 'neutral'} />
      </KpiStrip>
      <Pane
        paneId="board"
        label="Leaderboard"
        grow={1.3}
        pad="none"
        summary={leader ? `${repName(leader)} leads with ${leader.booked} booked` : undefined}
        tabs={[
          { id: 'reps', label: 'Reps', count: data.members.length },
          { id: 'trend', label: 'Weekly trend' },
        ]}
        tab={boardTab}
        onTab={(x) => setBoardTab(x as BoardTab)}
      >
        {boardTab === 'reps' ? (
          <>
            <p className="cue-hint web-team-note">Ranked by meetings booked. Booking rate counts answered calls only. Pick a rep to see them on the right.</p>
            <DataTable label="Team leaderboard" columns={columns} rows={data.members} rowKey={(m) => m.rep.id} selectedKey={rep} onSelect={(m) => onPick(m.rep.id)} minWidth={640} />
          </>
        ) : (
          <div className="web-pad">
            <WeeklyTrend mine={teamTotals(trend ?? data)} avg={teamWeekly(trend ?? data)} labels={['Team total', 'Average per rep']} />
          </div>
        )}
      </Pane>
      <Pane
        paneId="learning"
        label="Team learning"
        pad="none"
        summary={calls ? `${good.length} working · ${bad.length} not` : undefined}
        tabs={[
          { id: 'good', label: "What's working", count: calls ? good.length : undefined },
          { id: 'bad', label: "What isn't", count: calls ? bad.length : undefined },
        ]}
        tab={learnTab}
        onTab={(x) => setLearnTab(x as ThemeTab)}
      >
        <p className="cue-hint web-team-note">{`Themes from the team's last ${calls?.length ?? 0} calls. These are the labels Mubit trains on.`}</p>
        {!calls ? (
          <div className="web-pad">
            <Skeleton lines={4} />
          </div>
        ) : learnTab === 'good' ? (
          <Themes items={good} tone="ok" empty="Debriefs fill this in." />
        ) : (
          <Themes items={bad} tone="warn" empty="Nothing flagged yet." />
        )}
      </Pane>
    </>
  );
}

const LATEST_COLS: Column<CallSummary>[] = SHORT_CALL_COLS;

/** Team view drawer: the chosen rep's numbers and latest calls. */
function RepDrawer({ member, me, calls, historyHref, onOpen }: { member: TeamMember | null; me: string; calls: CallSummary[] | null; historyHref: string | null; onOpen: () => void }) {
  if (!member) {
    return (
      <Pane label="Rep" side="drawer" as="aside">
        <EmptyState compact title="Pick a rep">
          Choose someone on the leaderboard to see their numbers and latest calls.
        </EmptyState>
      </Pane>
    );
  }
  const m = member;
  return (
    <Pane
      label="Rep"
      side="drawer"
      pad="none"
      as="aside"
      meta={m.rep.id === me ? 'you' : undefined}
      footer={
        <span className="web-chips">
          <Button size="sm" variant="primary" onClick={onOpen}>
            Open their numbers
          </Button>
          {historyHref && (
            <a className="cue-btn cue-btn--secondary cue-btn--sm" href={historyHref}>
              Their calls in History
            </a>
          )}
        </span>
      }
    >
      <div className="web-pad web-pad--tight">
        <span className="web-team-name">{repName(m)}</span>
      </div>
      <KeyValue
        className="web-kv-inset"
        items={[
          { label: 'Calls', value: <span className="cue-num">{`${m.calls} · ${m.connected} answered`}</span> },
          { label: 'Booked', value: <span className="cue-num">{`${m.booked} · ${m.connected ? formatPercent(m.bookingRate) : '—'} of answered`}</span> },
          { label: 'Suggestions', value: <span className="cue-num">{m.cuesShown ? `${formatPercent(pct(m.cuesUsed, m.cuesShown))} used · ${m.cuesUsed} of ${m.cuesShown}` : '—'}</span> },
          { label: 'Rating', value: <span className="cue-num">{fmtRating(m.avgRating)}</span> },
          { label: 'Debriefed', value: <span className="cue-num">{`${m.debriefed ?? 0}/${m.calls}`}</span> },
          { label: 'Last call', value: <span className="web-nowrap">{m.lastCallAt ? whenLabel(m.lastCallAt) : '—'}</span> },
        ]}
      />
      <div className="web-pad web-pad--tight">
        <span className="cue-label">Latest calls</span>
      </div>
      {!calls ? (
        <div className="web-pad">
          <Skeleton lines={4} />
        </div>
      ) : (
        <DataTable
          label="Latest calls"
          columns={LATEST_COLS}
          rows={calls.slice(0, 8)}
          rowKey={(c) => c.id}
          onSelect={(c) => openDebrief(c.id)}
          minWidth={320}
          empty={<p className="web-muted web-small web-pad">No calls in this period.</p>}
        />
      )}
    </Pane>
  );
}
