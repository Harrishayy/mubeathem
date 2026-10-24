import { OUTCOMES, OUTCOME_LABEL, formatDuration, type CallListQuery, type CallSummary, type CallView, type SuggestionAction } from '@cue/core';
import { ActionBar, Button, Chip, DataTable, EmptyState, ErrorState, KeyValue, MomentChip, Pane, PaneSection, Skeleton, Sprout, type ChipTone, type Column } from '@cue/ui';
import { useEffect, useState } from 'react';
import { useMedia } from '../hooks/useMedia';
import { useResource } from '../hooks/useResource';
import { hrefFor, navigate, replaceHash, useHashQuery } from '../router';
import { getApi } from '../state/api';
import { openDebrief, toast } from '../state/ui';
import { useDebounced } from '../hooks/useDebounced';
import { reducedMotion } from '../lib/motion';

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function callStatus(c: { status: CallSummary['status']; outcome: string | null }): { label: string; tone: ChipTone } {
  if (c.status === 'live') return { label: 'Live', tone: 'warn' };
  if (c.outcome === 'meeting_booked') return { label: OUTCOME_LABEL.meeting_booked, tone: 'ok' };
  if (c.outcome) return { label: OUTCOME_LABEL[c.outcome as keyof typeof OUTCOME_LABEL] ?? c.outcome, tone: 'neutral' };
  return { label: c.status === 'reviewing' ? 'Reviewing' : 'Ended', tone: 'accent' };
}

const ACTION: Record<SuggestionAction, { label: string; tone: ChipTone }> = {
  used: { label: 'Used', tone: 'ok' },
  edited: { label: 'Edited', tone: 'ok' },
  dismissed: { label: 'Skipped', tone: 'neutral' },
  thumbs_up: { label: 'Liked', tone: 'ok' },
  thumbs_down: { label: 'Disliked', tone: 'warn' },
  expired: { label: 'Not used', tone: 'neutral' },
};

const SOURCE: Record<CallSummary['source'], string> = { cue: 'Cue', trellus: 'Trellus', practice: 'Rehearsal', import: 'Imported' };

const who = (p: { name: string; company: string }) => p.name || p.company || 'Unnamed prospect';

export type HistoryRange = 'today' | '7d' | '30d' | 'all';
const RANGES: { value: HistoryRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
];

/** The start of a range, or undefined for all time. */
export function rangeFrom(range: HistoryRange, now = Date.now()): number | undefined {
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === '7d') return now - 7 * 86_400_000;
  if (range === '30d') return now - 30 * 86_400_000;
  return undefined;
}

type OutcomeFilter = NonNullable<CallListQuery['outcome']>;
const OUTCOME_FILTERS: OutcomeFilter[] = [...OUTCOMES, 'none'];
const isOutcome = (v: string | undefined): v is OutcomeFilter => !!v && (OUTCOME_FILTERS as string[]).includes(v);
const isRange = (v: string | undefined): v is HistoryRange => !!v && RANGES.some((r) => r.value === v);

export const ATTITUDE_LABEL: Record<string, string> = { friendly: 'Friendly', curious: 'Curious', neutral: 'Neutral', guarded: 'Guarded', irritated: 'Irritated', hostile: 'Hostile' };

const PAGE = 50;

/**
 * Past calls with filters that live in the URL (`#/history?rep=rep_alex&outcome=meeting_booked&range=7d`),
 * so Team can deep-link here. The selected call shows Cue's review, what went well and what didn't.
 */
export function History() {
  const hq = useHashQuery();
  const narrow = useMedia('(max-width: 599.98px)');
  const rep = hq.rep ?? '';
  const outcome = isOutcome(hq.outcome) ? hq.outcome : undefined;
  const range: HistoryRange = isRange(hq.range) ? hq.range : 'all';
  const onlyDebriefed = hq.debriefed === '1';
  const [text, setText] = useState(hq.q ?? '');
  const q = useDebounced(text.trim(), 300);

  const setFilter = (patch: Record<string, string | undefined>) => replaceHash(hrefFor({ name: 'history' }, { ...hq, ...patch }));
  useEffect(() => setText(hq.q ?? ''), [hq.q]);
  useEffect(() => {
    if ((hq.q ?? '') !== q) setFilter({ q: q || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const team = useResource((signal) => getApi().team({ from: 0 }, { signal }), [], 60_000);
  const members = team.data?.members ?? [];
  const query: CallListQuery = { limit: PAGE, ...(rep ? { repId: rep } : {}), ...(outcome ? { outcome } : {}), ...(hq.q ? { q: hq.q } : {}), ...(hq.contact ? { contactId: hq.contact } : {}), ...(onlyDebriefed ? { debriefed: '1' as const } : {}), ...(rangeFrom(range) !== undefined ? { from: rangeFrom(range) } : {}) };
  const key = JSON.stringify({ rep, outcome, range, q: hq.q ?? '', contact: hq.contact ?? '', onlyDebriefed });
  const res = useResource((signal) => getApi().listCalls(query, { signal }), [key], 10_000);
  const [extra, setExtra] = useState<CallSummary[]>([]);
  const [more, setMore] = useState<{ loading: boolean; done: boolean }>({ loading: false, done: false });
  useEffect(() => {
    setExtra([]);
    setMore({ loading: false, done: false });
  }, [key]);

  const base = res.data;
  const all = base ? [...base, ...extra.filter((x) => !base.some((y) => y.id === x.id))] : null;
  const calls = all;
  const canMore = !!base && base.length >= PAGE && !more.done;
  const [selected, setSelected] = useState<string | null>(null);
  const current = calls?.find((c) => c.id === selected) ?? calls?.[0] ?? null;
  const filtered = !!(rep || outcome || range !== 'all' || hq.q || hq.contact || onlyDebriefed);
  const repName = members.find((m) => m.rep.id === rep)?.rep.name ?? (rep || null);

  const loadMore = async () => {
    if (!all) return;
    setMore({ loading: true, done: false });
    try {
      const r = await getApi().listCalls({ ...query, offset: all.length });
      setExtra((x) => [...x, ...r]);
      setMore({ loading: false, done: r.length < PAGE });
    } catch (e) {
      setMore({ loading: false, done: false });
      toast({ tone: 'bad', title: 'Could not load more calls', description: e instanceof Error ? e.message : String(e) });
    }
  };

  const allColumns: Column<CallSummary>[] = [
    {
      key: 'prospect',
      header: 'Prospect',
      render: (c) => (
        <span className="web-hist-who">
          <span className="web-hist-who__name">{who(c.prospect)}</span>
          <span className="web-muted web-small">{[c.prospect.title, c.prospect.company].filter(Boolean).join(' · ') || SOURCE[c.source]}</span>
          {narrow && <span className="web-small">{[c.rep?.name, DATE.format(c.startedAt), c.rating != null ? `rated ${c.rating}/5` : null].filter(Boolean).join(' · ')}</span>}
        </span>
      ),
    },
    { key: 'rep', header: 'Rep', width: '130px', render: (c) => <span className="web-small">{c.rep?.name || <span className="web-muted">—</span>}</span> },
    {
      key: 'outcome',
      header: 'Outcome',
      width: '170px',
      render: (c) => {
        const st = callStatus(c);
        return (
          <Chip size="sm" tone={st.tone}>
            {st.label}
          </Chip>
        );
      },
    },
    { key: 'rating', header: 'Rating', width: '68px', mono: true, align: 'end', render: (c) => (c.rating != null ? `${c.rating}/5` : <span className="web-muted">—</span>) },
    { key: 'used', header: 'Used', width: '64px', mono: true, align: 'end', render: (c) => `${c.used}/${c.suggestions}` },
    { key: 'date', header: 'When', width: '150px', mono: true, render: (c) => <time dateTime={new Date(c.startedAt).toISOString()}>{DATE.format(c.startedAt)}</time> },
  ];
  const columns = narrow ? allColumns.filter((c) => c.key === 'prospect' || c.key === 'outcome').map((c) => (c.key === 'outcome' ? { ...c, width: undefined } : c)) : allColumns;

  return (
    <div className="web-hist">
      <h1 className="web-sr">Past calls</h1>
      <div className="web-filterbar" role="search" aria-label="Filter calls">
        <label className="web-filterbar__field">
          <span className="cue-label">Rep</span>
          <select className="web-input web-input--sm" value={rep} onChange={(e) => setFilter({ rep: e.target.value || undefined })} aria-label="Rep">
            <option value="">Everyone</option>
            {rep && !members.some((m) => m.rep.id === rep) && <option value={rep}>{rep}</option>}
            {members.map((m) => (
              <option key={m.rep.id} value={m.rep.id}>
                {m.rep.name || m.rep.id}
              </option>
            ))}
          </select>
        </label>
        <label className="web-filterbar__field">
          <span className="cue-label">Outcome</span>
          <select className="web-input web-input--sm" value={outcome ?? ''} onChange={(e) => setFilter({ outcome: e.target.value || undefined })} aria-label="Outcome">
            <option value="">Any outcome</option>
            {OUTCOME_FILTERS.map((o) => (
              <option key={o} value={o}>
                {o === 'none' ? 'No outcome yet' : OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <span className="web-filterbar__field">
          <span className="cue-label" id="hist-range">When</span>
          <span className="cue-filter" role="group" aria-labelledby="hist-range">
            {RANGES.map((r) => (
              <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setFilter({ range: r.value === 'all' ? undefined : r.value })}>
                {r.label}
              </button>
            ))}
          </span>
        </span>
        <label className="web-filterbar__field web-filterbar__search">
          <span className="cue-label">Search</span>
          <input type="search" className="web-input web-input--sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Prospect, company or rep" aria-label="Search calls" autoComplete="off" />
        </label>
        <span className="web-filterbar__field">
          <span className="cue-filter" role="group" aria-label="Debriefed">
            <button type="button" aria-pressed={onlyDebriefed} onClick={() => setFilter({ debriefed: onlyDebriefed ? undefined : '1' })}>
              Debriefed only
            </button>
          </span>
        </span>
        {hq.contact && <span className="cue-label">One contact's calls</span>}
        {filtered && (
          <Button size="sm" variant="ghost" icon="close" onClick={() => { setText(''); replaceHash(hrefFor({ name: 'history' })); }}>
            Clear filters
          </Button>
        )}
      </div>
      <div className="cue-dash-grid web-hist-grid">
        <Pane
          label="Calls"
          meta={calls ? `${calls.length}${canMore ? '+' : ''}${repName ? ` · ${repName}` : ''}` : undefined}
          hint="Every call, newest first. Pick one to see what went well and what didn't; open it to debrief."
          pad="none"
          className="web-hist-grid__list"
          footer={
            canMore ? (
              <ActionBar>
                <Button size="sm" variant="ghost" onClick={() => void loadMore()} loading={more.loading}>
                  Load older calls
                </Button>
              </ActionBar>
            ) : undefined
          }
        >
          {res.error && !calls ? (
            <ErrorState title="Can't load calls" message={res.error.message} onRetry={res.reload} className="web-pane-pad" />
          ) : !calls ? (
            <div className="web-pane-pad" aria-busy="true">
              <Skeleton lines={6} height={20} />
            </div>
          ) : (
            <DataTable
              label="Past calls"
              columns={columns}
              rows={calls}
              rowKey={(c) => c.id}
              selectedKey={current?.id}
              onSelect={(c) => {
                setSelected(c.id);
                if (!matchMedia('(min-width: 1080px)').matches) requestAnimationFrame(() => document.getElementById('history-detail')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
              }}
              minWidth={narrow ? 0 : 760}
              empty={
                filtered ? (
                  <EmptyState compact title="No calls match these filters" action={<Button size="sm" variant="secondary" onClick={() => { setText(''); replaceHash(hrefFor({ name: 'history' })); }}>Clear filters</Button>}>
                    Try a wider date range or another rep.
                  </EmptyState>
                ) : (
                  <EmptyState art={<Sprout state="idle" size={84} />} title="No calls yet" action={<Button variant="primary" icon="users" onClick={() => navigate({ name: 'contacts' })}>Pick someone to call</Button>}>
                    Call someone from Contacts or Live, and the call shows up here with its outcome and review.
                  </EmptyState>
                )
              }
            />
          )}
        </Pane>
        <CallDetail call={current} />
      </div>
    </div>
  );
}

function CallDetail({ call }: { call: CallSummary | null }) {
  const id = call?.id ?? null;
  const res = useResource((signal) => (id ? getApi().getCall(id, { signal }) : Promise.resolve(null)), [id]);
  const view: CallView | null = res.data && res.data.id === id ? res.data : null;
  if (!call) {
    return (
      <Pane label="Call" as="aside" className="web-hist-grid__detail">
        <EmptyState compact title="No call selected">
          Pick a call to see Cue&rsquo;s review, what went well and what didn&rsquo;t.
        </EmptyState>
      </Pane>
    );
  }
  const st = callStatus(call);
  const live = call.status === 'live';
  const reviewed = !!view?.feedback || call.rating != null;
  const well = call.wentWell ?? [];
  const badly = call.wentBadly ?? [];
  const summary = call.reviewSummary ?? view?.review?.summary ?? null;
  return (
    <Pane
      label="Call"
      id="history-detail"
      as="aside"
      pad="none"
      className="web-hist-grid__detail"
      actions={
        <Chip size="sm" tone={st.tone}>
          {st.label}
        </Chip>
      }
      footer={
        <ActionBar>
          {live ? (
            <Button variant="primary" icon="arrow-right" onClick={() => navigate({ name: 'live' })}>
              Back to the call
            </Button>
          ) : (
            <Button variant="primary" icon="arrow-right" onClick={() => openDebrief(call.id)}>
              {reviewed ? 'See the review' : 'Debrief'}
            </Button>
          )}
          {call.contactId && (
            <Button variant="ghost" icon="user" onClick={() => navigate({ name: 'contacts' })}>
              Contacts
            </Button>
          )}
        </ActionBar>
      }
    >
      <div className="web-prospect">
        <h2 className="web-prospect__name">{who(call.prospect)}</h2>
        <p className="cue-label">{[call.prospect.title, call.prospect.company].filter(Boolean).join(' · ') || 'No title or company saved'}</p>
        <KeyValue
          items={[
            ...(call.rep?.name ? [{ label: 'Rep', value: call.rep.name }] : []),
            { label: 'Outcome', value: st.label },
            { label: 'When', value: <span className="cue-num">{DATE.format(call.startedAt)}</span> },
            ...(call.durationMs !== null ? [{ label: 'Length', value: <span className="cue-num">{formatDuration(call.durationMs)}</span> }] : []),
            { label: 'Suggestions', value: <span className="cue-num">{`${call.used} used of ${call.suggestions} shown`}</span> },
            ...(call.rating != null ? [{ label: 'Rep\u2019s rating', value: <span className="cue-num">{`${call.rating} of 5`}</span> }] : []),
            ...(call.attitude ? [{ label: 'Their attitude', value: ATTITUDE_LABEL[call.attitude] ?? call.attitude }] : []),
            ...(call.source !== 'cue' ? [{ label: 'Source', value: SOURCE[call.source] }] : []),
          ]}
        />
      </div>
      <PaneSection label="Cue's review">
        {summary ? (
          <p className="web-small">{summary}</p>
        ) : (
          <p className="web-muted web-small">{live ? 'The review comes after the call.' : reviewed ? 'Cue is still writing the review.' : 'Debrief this call and Cue writes a short review of what worked.'}</p>
        )}
      </PaneSection>
      <div className="web-wins">
        <PaneSection label="Went well" meta={well.length ? String(well.length) : undefined} className="web-review__list is-ok">
          {well.length ? (
            <ul className="web-bullets web-small">
              {well.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="web-muted web-small">Nothing noted yet.</p>
          )}
        </PaneSection>
        <PaneSection label="Didn't go well" meta={badly.length ? String(badly.length) : undefined} className="web-review__list is-warn">
          {badly.length ? (
            <ul className="web-bullets web-small">
              {badly.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="web-muted web-small">Nothing noted yet.</p>
          )}
        </PaneSection>
      </div>
      <PaneSection label="Suggestions shown" meta={view ? String(view.history.length) : undefined} hint="Each line Cue put on screen during the call, and what the rep did with it.">
        {res.error && !view ? (
          <p className="web-muted web-small">Can&rsquo;t load this call&rsquo;s suggestions: {res.error.message}</p>
        ) : !view ? (
          <Skeleton lines={3} />
        ) : view.history.length === 0 ? (
          <p className="web-muted web-small">Cue showed no suggestions on this call.</p>
        ) : (
          <ol className="web-hist-cues">
            {view.history.map((h) => {
              const a = h.action ? ACTION[h.action] : null;
              return (
                <li key={h.suggestion.id} className="web-hist-cue">
                  <span className="web-hist-cue__head">
                    <MomentChip moment={h.suggestion.kind === 'compliance' ? 'compliance' : h.suggestion.situation.moment} size="sm" />
                    <Chip size="sm" tone={a?.tone ?? 'neutral'}>
                      {a?.label ?? 'No action'}
                    </Chip>
                  </span>
                  <span className="web-hist-cue__line">{h.suggestion.say}</span>
                </li>
              );
            })}
          </ol>
        )}
      </PaneSection>
    </Pane>
  );
}
