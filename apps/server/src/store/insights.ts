import { MOMENTS, TASK_IDS, type CallEvent, type InsightsResponse, type Moment, type Outcome, type TaskId, type TaskInsight, type TraceRange } from '@cue/core';
import type { Db } from './db';
import { percentile } from './telemetry';
import { rangeSince, type TraceStore } from './traces';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1e4) / 1e4 : 0);
const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 0.5);

/** Event types the outcome insights read; everything else in the log is skipped at the SQL level. */
const OUTCOME_EVENTS = ['situation.read', 'suggestion.shown', 'suggestion.action', 'outcome.recorded', 'feedback.submitted', 'review.completed'] as const;

/**
 * `GET /api/insights`: per-task Mubit numbers from the trace store, and what worked on calls from
 * the event log (calls started in the window). Pure reads; safe while the server is live.
 */
export function computeInsights(db: Db, traces: TraceStore, range: TraceRange, now: number): InsightsResponse {
  const since = rangeSince(range, now);
  const bucket: 'hour' | 'day' = range === '24h' ? 'hour' : 'day';
  const size = bucket === 'hour' ? HOUR : DAY;
  const rows = traces.metadata(since);

  /* per task */
  const tasks: TaskInsight[] = TASK_IDS.map((task) => {
    const mine = rows.filter((r) => r.task === task);
    const lat = mine.filter((r) => r.ok).map((r) => r.latencyMs).sort((a, b) => a - b);
    const errorsByCode: Record<string, number> = {};
    let aborted = 0;
    for (const r of mine) {
      if (r.ok) continue;
      if (r.aborted) aborted++;
      else errorsByCode[r.errorCode ?? 'unknown'] = (errorsByCode[r.errorCode ?? 'unknown'] ?? 0) + 1;
    }
    const ok = mine.filter((r) => r.ok).length;
    return {
      task,
      calls: mine.length,
      ok,
      failed: mine.length - ok - aborted,
      aborted,
      p50Ms: percentile(lat, 0.5),
      p95Ms: percentile(lat, 0.95),
      costUsd: round6(mine.reduce((a, r) => a + r.costUsd, 0)),
      inputTokens: mine.reduce((a, r) => a + r.inputTokens, 0),
      outputTokens: mine.reduce((a, r) => a + r.outputTokens, 0),
      errorsByCode,
    };
  });

  /* series */
  const buckets = new Map<string, { t: number; task: TaskId; calls: number; cost: number; lat: number[] }>();
  for (const r of rows) {
    const t = Math.floor(r.at / size) * size;
    const k = `${t}|${r.task}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { t, task: r.task, calls: 0, cost: 0, lat: [] }));
    b.calls++;
    b.cost += r.costUsd;
    if (r.ok) b.lat.push(r.latencyMs);
  }
  const series = [...buckets.values()]
    .sort((a, b) => a.t - b.t || TASK_IDS.indexOf(a.task) - TASK_IDS.indexOf(b.task))
    .map((b) => ({ t: b.t, task: b.task, calls: b.calls, costUsd: round6(b.cost), p50Ms: median(b.lat) }));

  return {
    range,
    since,
    until: now,
    bucket,
    tasks,
    totals: {
      calls: rows.length,
      ok: rows.filter((r) => r.ok).length,
      costUsd: round6(rows.reduce((a, r) => a + r.costUsd, 0)),
      inputTokens: rows.reduce((a, r) => a + r.inputTokens, 0),
      outputTokens: rows.reduce((a, r) => a + r.outputTokens, 0),
    },
    series,
    outcomes: outcomeInsights(db, since),
  };
}

interface CardAgg {
  moment: Moment;
  lineId: string;
  used: boolean;
  stepWin: boolean | null;
}

function outcomeInsights(db: Db, since: number): InsightsResponse['outcomes'] {
  const calls = db.prepare('SELECT id FROM calls WHERE started_at >= ?').all(since) as { id: string }[];
  const placeholders = OUTCOME_EVENTS.map(() => '?').join(', ');
  const events = db
    .prepare(`SELECT e.json FROM events e JOIN calls c ON c.id = e.call_id WHERE c.started_at >= ? AND e.type IN (${placeholders}) ORDER BY e.call_id, e.seq`)
    .all(since, ...OUTCOME_EVENTS) as { json: string }[];
  const byCall = new Map<string, CallEvent[]>();
  for (const r of events) {
    const e = JSON.parse(r.json) as CallEvent;
    let list = byCall.get(e.callId);
    if (!list) byCall.set(e.callId, (list = []));
    list.push(e);
  }

  const lineText = new Map<string, string>();
  for (const r of db.prepare('SELECT id, json FROM playbook_lines').all() as { id: string; json: string }[]) {
    try {
      lineText.set(r.id, (JSON.parse(r.json) as { text?: string }).text ?? '');
    } catch {
      /* skip a bad row */
    }
  }

  const momentAgg = new Map<Moment, { shown: number; used: number; judged: number; stepWins: number; booked: number }>();
  const lineAgg = new Map<string, { text: string; moment: Moment; shown: number; used: number; booked: number }>();
  const cards = { mubit: 0, rules: 0, cache: 0 };
  const reads = { mubit: 0, rules: 0 };
  const writePath = { speculative: 0, rewritten: 0, direct: 0 };
  const latencies: number[] = [];
  const impacts: number[] = [];
  const ratings: number[] = [];
  let reviewsMubit = 0;
  let withOutcome = 0;
  let booked = 0;
  const usage = { used: { calls: 0, booked: 0 }, notUsed: { calls: 0, booked: 0 } };

  for (const { id } of calls) {
    const list = byCall.get(id) ?? [];
    let outcome: Outcome | null = null;
    let feedbackOutcome: Outcome | null = null;
    const shown = new Map<string, CardAgg>();
    const versions = new Map<string, { servedBy: keyof typeof cards; writePath: keyof typeof writePath | undefined }>();
    for (const e of list) {
      switch (e.type) {
        case 'situation.read':
          reads[e.servedBy]++;
          break;
        case 'suggestion.shown': {
          const s = e.suggestion;
          // A refined card re-uses the instant card's id: count the card once, as its latest version;
          // its latency stays the first version's (what the rep waited for).
          const prior = versions.get(s.id);
          if (prior) {
            cards[prior.servedBy]--;
            if (prior.writePath) writePath[prior.writePath]--;
          } else if (s.kind === 'line') latencies.push(s.latencyMs);
          cards[s.servedBy]++;
          if (s.kind === 'line' && s.writePath) writePath[s.writePath]++;
          versions.set(s.id, { servedBy: s.servedBy, writePath: s.kind === 'line' ? s.writePath : undefined });
          const was = shown.get(s.id);
          shown.set(s.id, { moment: s.situation.moment, lineId: s.lineId, used: was?.used ?? false, stepWin: was?.stepWin ?? null });
          if (!lineText.has(s.lineId)) lineText.set(s.lineId, s.say);
          break;
        }
        case 'suggestion.action': {
          const c = shown.get(e.suggestionId);
          if (c && (e.action === 'used' || e.action === 'edited')) c.used = true;
          break;
        }
        case 'outcome.recorded':
          outcome = e.outcome.outcome;
          break;
        case 'feedback.submitted':
          feedbackOutcome = e.feedback.outcome;
          if (typeof e.feedback.rating === 'number') ratings.push(e.feedback.rating);
          break;
        case 'review.completed':
          impacts.push(e.review.suggestionImpact);
          if (e.servedBy === 'mubit') reviewsMubit++;
          for (const l of e.review.linesUsed) {
            const c = shown.get(l.suggestionId);
            if (!c) continue;
            if (l.used) c.used = true;
            c.stepWin = l.stepWin;
          }
          break;
        default:
          break;
      }
    }
    const final = outcome ?? feedbackOutcome;
    const isBooked = final === 'meeting_booked';
    if (final && final !== 'unknown') {
      withOutcome++;
      if (isBooked) booked++;
      const anyUsed = [...shown.values()].some((c) => c.used);
      const side = anyUsed ? usage.used : usage.notUsed;
      side.calls++;
      if (isBooked) side.booked++;
    }
    for (const c of shown.values()) {
      let m = momentAgg.get(c.moment);
      if (!m) momentAgg.set(c.moment, (m = { shown: 0, used: 0, judged: 0, stepWins: 0, booked: 0 }));
      m.shown++;
      if (c.used) m.used++;
      if (c.stepWin !== null) m.judged++;
      if (c.stepWin) m.stepWins++;
      if (isBooked) m.booked++;
      let l = lineAgg.get(c.lineId);
      if (!l) lineAgg.set(c.lineId, (l = { text: lineText.get(c.lineId) ?? '', moment: c.moment, shown: 0, used: 0, booked: 0 }));
      l.shown++;
      if (c.used) l.used++;
      if (isBooked) l.booked++;
    }
  }

  const sortedLat = latencies.sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4 : null);
  return {
    calls: { total: calls.length, withOutcome, booked, bookingRate: rate(booked, withOutcome) },
    cueUsage: {
      used: { ...usage.used, bookingRate: rate(usage.used.booked, usage.used.calls) },
      notUsed: { ...usage.notUsed, bookingRate: rate(usage.notUsed.booked, usage.notUsed.calls) },
    },
    moments: MOMENTS.filter((m) => momentAgg.has(m)).map((moment) => {
      const m = momentAgg.get(moment)!;
      return { moment, ...m, usedRate: rate(m.used, m.shown), stepWinRate: rate(m.stepWins, m.judged), bookedRate: rate(m.booked, m.shown) };
    }),
    topLines: [...lineAgg.entries()]
      .map(([lineId, l]) => ({ lineId, ...l, usedRate: rate(l.used, l.shown), bookedRate: rate(l.booked, l.shown) }))
      .sort((a, b) => b.booked - a.booked || b.used - a.used || b.shown - a.shown || a.lineId.localeCompare(b.lineId))
      .slice(0, 10),
    servedBy: { cards, reads },
    writePath,
    latency: { cards: sortedLat.length, p50Ms: percentile(sortedLat, 0.5), p95Ms: percentile(sortedLat, 0.95) },
    reviews: { count: impacts.length, mubit: reviewsMubit, avgSuggestionImpact: avg(impacts), avgRating: avg(ratings) },
  };
}
