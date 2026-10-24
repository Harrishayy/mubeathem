import { OUTCOME_LABEL, type CallSummary, type Outcome, type Prospect, type ResearchBriefResponse } from '@cue/core';
import { Button, EmptyState, ErrorState, Icon, Skeleton, Sprout } from '@cue/ui';
import { useEffect, useState } from 'react';
import { request, type SessionState } from '../../src/messages';
import type { Settings } from '../../src/settings';
import { bestHours, hourWords, pastCallsFor, prospectKey } from '../../src/ui/companion';
import { ago, role } from '../../src/ui/format';
import { BesideNote, HookList, Section, SourceList, Who, useBeside } from './parts';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string };

async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

/** The brief for whoever is on the page, re-asked when the page shows someone else. */
function useBrief(p: Prospect | null) {
  const key = prospectKey(p);
  const [load, setLoad] = useState<Load<ResearchBriefResponse>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!p || (!p.name.trim() && !p.company.trim())) return;
    let live = true;
    setLoad({ state: 'loading' });
    void request<ResearchBriefResponse>({ type: 'research.brief', prospect: p }).then((res) => {
      if (live) setLoad(res.ok ? { state: 'ok', data: res.data } : { state: 'error', message: res.error });
    });
    return () => {
      live = false;
    };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { load, retry: () => setTick((t) => t + 1) };
}

/** The team's recent calls: this person's history, and when the team gets people on the phone. */
export function useTeamCalls(): Load<CallSummary[]> {
  const [load, setLoad] = useState<Load<CallSummary[]>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    void request<CallSummary[]>({ type: 'calls.search', limit: 200 }).then((res) => {
      if (live) setLoad(res.ok ? { state: 'ok', data: res.data } : { state: 'error', message: res.error });
    });
    return () => {
      live = false;
    };
  }, []);
  return load;
}

const INDEX = [
  { id: 'say', label: 'Say' },
  { id: 'why', label: 'Why now' },
  { id: 'company', label: 'Company' },
  { id: 'history', label: 'History' },
  { id: 'sources', label: 'Sources' },
];

/**
 * Before the call: everything about the person the page (HubSpot, or Trellus dialling) shows, read
 * for the rep, in the order they need it: what to open with, why now, the company, the history,
 * and where it all came from. Nothing to fill in. Cue starts by itself when Trellus connects.
 */
export function Ready({ state, settings }: { state: SessionState; settings: Settings }) {
  const p = state.page?.prospect ?? null;
  const trellus = state.page?.trellus;
  const { load, retry } = useBrief(p);
  const team = useTeamCalls();
  const beside = useBeside();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!p || (!p.name.trim() && !p.company.trim() && !p.phone)) {
    return (
      <main className="sp-main">
        <EmptyState title="Waiting for the next contact" art={<Sprout state="idle" size={72} decorative />}>
          Open a contact in HubSpot, or let Trellus dial. Cue reads who you're calling from the page and has the brief ready before they pick up.
        </EmptyState>
        <ul className="sp-tips">
          <li>
            <Icon name="search" size={14} /> Type <kbd className="sp-kbd">cue</kbd> and a name in the address bar to find anyone you've called.
          </li>
          <li>
            <Icon name="arrow-up-right" size={14} /> Right-click any link to open it beside your call.
          </li>
        </ul>
      </main>
    );
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await request({ type: 'session.start', prospect: p, tabId: state.page?.tabId ?? (await activeTabId()), source: trellus?.present ? 'trellus' : 'cue' });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  const brief = load.state === 'ok' ? load.data.brief : null;
  const past = team.state === 'ok' ? pastCallsFor(team.data, p) : [];
  const hours = team.state === 'ok' ? bestHours(team.data) : null;
  const facts = Object.entries(p.facts).filter(([, v]) => v.trim()).slice(0, 8);
  const ringing = trellus?.state === 'dialing';
  const kicker = ringing ? 'Trellus is dialling' : trellus?.state === 'connected' ? 'Trellus connected' : 'Up next';

  return (
    <>
      <Who name={p.name || p.phone || p.company} role={role(p)} kicker={kicker} />
      <nav className="sp-index" aria-label="Brief sections">
        {INDEX.map((s) => (
          <a key={s.id} className="sp-index__link" href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>
      <main className="sp-main">
        {state.error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{state.error}</span>
          </p>
        )}
        <div className="sp-chips-row">
          {past[0] ? (
            <span className="sp-fact-chip">
              Last call {ago(past[0].startedAt)}: {past[0].outcome ? (OUTCOME_LABEL[past[0].outcome as Outcome] ?? past[0].outcome).toLowerCase() : 'no outcome'}
            </span>
          ) : team.state === 'ok' ? (
            <span className="sp-fact-chip">First call to {p.name.split(' ')[0] || 'them'}</span>
          ) : null}
          {p.facts.stage && <span className="sp-fact-chip">{p.facts.stage}</span>}
        </div>

        <Section id="say" label="Open with" meta={brief ? (brief.servedBy === 'mubit' ? 'written for them' : 'from the playbook') : undefined}>
          {load.state === 'loading' ? (
            <div className="sp-card" aria-busy="true">
              <Skeleton lines={2} height={20} />
              <Skeleton width="50%" height={12} />
            </div>
          ) : load.state === 'error' ? (
            <ErrorState compact title="Couldn't get the brief" message={load.message} onRetry={retry} />
          ) : (
            <div className="sp-card cue-fam-opener">
              <p className="sp-opener">“{brief!.opener}”</p>
              {brief!.summary && <p className="sp-card__sub">{brief!.summary}</p>}
            </div>
          )}
        </Section>

        <Section id="why" label="Why now" meta={brief ? `${brief.hooks.length} ${brief.hooks.length === 1 ? 'reason' : 'reasons'}${load.state === 'ok' && load.data.configured ? ' · researched' : ''}` : undefined}>
          {brief ? <HookList hooks={brief.hooks} beside={beside} /> : load.state === 'loading' ? <Skeleton lines={3} /> : null}
          <BesideNote beside={beside} />
        </Section>

        <Section id="company" label="Company" meta={p.company || undefined}>
          {facts.length ? (
            <dl className="sp-facts">
              {facts.map(([k, v]) => (
                <div key={k} className="sp-fact">
                  <dt className="cue-label">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="sp-quiet">HubSpot shows no company details for this contact.</p>
          )}
        </Section>

        <Section id="history" label="History" meta={team.state === 'ok' ? `${past.length} past ${past.length === 1 ? 'call' : 'calls'} · whole team` : undefined}>
          {team.state === 'loading' ? (
            <Skeleton lines={2} />
          ) : team.state === 'error' ? (
            <p className="sp-quiet">Past calls aren't available: {team.message}</p>
          ) : past.length ? (
            <ul className="sp-past">
              {past.slice(0, 4).map((c) => (
                <li key={c.id} className="sp-past__item">
                  <span className="sp-past__head">
                    <b>{new Date(c.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b>
                    <span>
                      {' · '}
                      {c.rep?.name || 'a teammate'} · {c.outcome ? (OUTCOME_LABEL[c.outcome as Outcome] ?? c.outcome) : 'no outcome'}
                    </span>
                  </span>
                  {(c.reviewSummary || c.wentWell?.[0]) && <span className="sp-past__note">{c.reviewSummary ?? c.wentWell![0]}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-quiet">Nobody on the team has called {p.name.split(' ')[0] || 'them'} yet.</p>
          )}
          {hours && (
            <div className="sp-hours">
              <span className="sp-hours__head">
                Your team connects most <b>{hourWords(hours.best.hour)}</b>
              </span>
              <div className="sp-hours__bars" role="img" aria-label={`Connect rate by hour, best ${hourWords(hours.best.hour)}`}>
                {hours.buckets.map((b) => (
                  <span key={b.hour} className={`sp-hours__bar${b === hours.best ? ' is-best' : ''}`} style={{ height: `${Math.max(6, Math.round(b.rate * 100))}%` }} />
                ))}
              </div>
              <div className="sp-hours__axis" aria-hidden>
                <span>8a</span>
                <span>12p</span>
                <span>5p</span>
              </div>
            </div>
          )}
        </Section>

        <Section id="sources" label="Sources" meta={brief?.sources?.length ? `${brief.sources.filter((s) => s.url).length} pages` : undefined}>
          {brief ? <SourceList sources={brief.sources ?? []} beside={beside} /> : <Skeleton lines={2} />}
        </Section>
      </main>
      <footer className="sp-dock" aria-label="Start">
        {error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
        <div className="sp-dock__row">
          <Button variant="primary" icon="spark" loading={busy} onClick={() => void start()}>
            Start Cue
          </Button>
          <span className="sp-dock__hint">{settings.autoStart && trellus?.present ? 'Or it starts by itself when Trellus connects.' : 'Starts listening to this tab and your mic.'}</span>
        </div>
      </footer>
    </>
  );
}
