import type { CallEvent, TaskId, TaskInput, TaskOutput } from '@cue/core';
import { findRiskyClaims, rulesReadMoment } from '@cue/core';
import { boot, type BootOptions, type CueServer } from '../src/boot';
import type { MubitClient, RunOptions, StreamOptions, TaskResult } from '../src/adapters/mubit';
import { loadConfig, type ServerConfig } from '../src/config';
import { rulesProspect } from '../src/pipeline/practice';
import { SentTracker } from '../src/services/sent';

export type FakeFailure = 'timeout' | 'bad_output' | 'http' | 'hang';

export interface FakeMubitOptions {
  delayMs?: Partial<Record<TaskId, number>>;
  /** Per-run delay (wins over `delayMs`), e.g. drawn from a measured latency distribution. */
  delay?: (task: TaskId) => number;
  fail?: Partial<Record<TaskId, FakeFailure>>;
  /** Override an output per task (receives the input). */
  outputs?: { [K in TaskId]?: (input: TaskInput<K>) => TaskOutput<K> };
}

export interface FakeMubit extends MubitClient {
  /** Every fake run counts as sent the moment it starts (as if the request left immediately). */
  sent: SentTracker;
  calls: { task: TaskId; sessionId: string; aborted: boolean; input: unknown }[];
  count(task?: TaskId): number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
    });
  });

/** A deterministic stand-in for @cue/mubit: honours abort signals, can be slow or fail per task. */
export function fakeMubit(opts: FakeMubitOptions = {}): FakeMubit {
  let n = 0;
  const calls: FakeMubit['calls'] = [];
  const defaults: { [K in TaskId]: (input: TaskInput<K>) => TaskOutput<K> } = {
    read_moment: (input) => ({ ...rulesReadMoment(input), rationale: 'fake model read' }),
    write_line: (input) => ({
      say: `${input.candidates[0]?.text ?? 'Hello'}`,
      why: 'fake: top line for this situation',
      line_id: input.candidates[0]?.line_id ?? 'none',
      up_next: [{ if_they_say: 'We have a broker', move: 'Ask when they last re-quoted', moment: 'objection_broker' }],
      risky_claim: null,
    }),
    research_brief: (input) => ({
      summary: `${input.prospect.title} at ${input.prospect.company}`,
      hooks: [{ hook: 'Recent raise: board expects D&O', product: 'd_and_o', source: null }],
      opener: 'Quick one: has anyone talked to you about D&O since the raise?',
      persona_guess: 'ceo',
    }),
    check_claim: (input) => {
      const hit = findRiskyClaims(input.claim)[0];
      return hit
        ? { verdict: 'violation', rule: hit.rule, rephrase: hit.rephrase, confidence: 0.9 }
        : { verdict: 'supported', rule: '', rephrase: null, confidence: 0.8 };
    },
    review_call: (input) => ({
      summary: 'fake review',
      outcome: input.record.outcome?.outcome ?? 'unknown',
      lines_used: input.record.suggestions.map((x) => ({ suggestion_id: x.id, used: true, said_text: x.say, similarity: 0.9, step_win: true })),
      candidate_lines: [{ moment: 'objection_broker', persona: 'ceo', receptivity: 'cool', text: 'Brokers are great at renewals. Who re-shops you after a raise?', turn_id: null, rationale: 'rep improvised and it worked' }],
      missed_moments: [],
      what_worked: ['kept it short'],
      what_didnt: [],
      customer_attitude: 'curious',
      coaching: ['ask for the meeting sooner'],
      suggestion_impact: 0.6,
    }),
    simulate_prospect: (input) =>
      rulesProspect(input.transcript.filter((t) => t.speaker === 'prospect').length, { mood: input.persona.mood, objections: input.persona.objections }, input.persona.name),
    live_cue: (input) => {
      // The fake "model" reads with the rules engine so tests are deterministic; the real one reads semantically.
      const last = input.transcript[input.transcript.length - 1];
      const read = rulesReadMoment({ crm: { title: input.prospect.title, company: input.prospect.company, facts: {} }, window: input.transcript.map((t, i) => ({ ...t, tMs: i * 3000 })), features: { turnIndex: input.transcript.length - 1, prospectWords: (last?.text ?? '').split(/\s+/).length, repWords: 0, prospectShare: 0.5, shareTrend: 0, interrupted: false, questionsAsked: 0, elapsedMs: 0 }, previous: input.previous });
      const line = input.playbook.find((l) => l.moment === read.moment);
      return {
        meaning: `fake read: ${read.rationale}`.slice(0, 80),
        moment: read.moment,
        persona: read.persona,
        receptivity: read.receptivity,
        line_id: line?.line_id ?? 'none',
        say: read.should_suggest ? (line?.text ?? 'Fair enough. What would make this worth thirty seconds?') : '',
        why: 'fake: top playbook line',
        up_next: [{ if_they_say: 'We have a broker', move: 'Ask when they last re-quoted', moment: 'objection_broker' }],
        risky_claim: null,
      };
    },
    synth_brief: (input) => ({
      trigger: "you're selling software to startups",
      blurb: `A software company. ${input.company} sells to startups.`,
      kind: 'Software',
      does: 'Sells software to startups',
      targeting: 'Startups',
      employees: '',
      founded: '',
      city: '',
      stage: '',
      valuation: '',
      people: [],
      risk: 'An outage or bug in their software costs their customers money.',
      policies: [{ name: 'Technology E&O / Tech & AI Liability', reason: 'they sell software' }],
    }),
  };

  const sent = new SentTracker();
  const client: FakeMubit = {
    sent,
    calls,
    count: (task) => (task ? calls.filter((c) => c.task === task).length : calls.length),
    async run<K extends TaskId>(task: K, input: TaskInput<K>, o: RunOptions): Promise<TaskResult<K>> {
      const delay = opts.delay?.(task) ?? opts.delayMs?.[task] ?? 0;
      const entry = { task, sessionId: o.sessionId, aborted: false, input };
      calls.push(entry);
      sent.mark(o.sessionId, task);
      const failure = opts.fail?.[task];
      try {
        if (failure === 'hang') await sleep(60_000, o.signal);
        await sleep(delay, o.signal);
      } catch (e) {
        entry.aborted = true;
        throw e;
      }
      if (failure === 'timeout') throw Object.assign(new Error('timed out'), { code: 'timeout', status: null, retryable: true, requestId: null });
      if (failure === 'bad_output') throw Object.assign(new Error('output failed schema'), { code: 'bad_output', status: 200, retryable: false, requestId: `mreq_bad_${++n}` });
      if (failure === 'http') throw Object.assign(new Error('upstream 500'), { code: 'http', status: 500, retryable: true, requestId: null });
      const make = (opts.outputs?.[task] ?? defaults[task]) as (i: TaskInput<K>) => TaskOutput<K>;
      return { output: make(input), requestId: `mreq_fake_${++n}`, latencyMs: delay || 1, model: 'gpt-4o-mini', usage: { input: 100, output: 20 }, costUsd: 0.00003, attempts: 1 };
    },
    /** Bag-of-words vectors: deterministic, and close for texts that share most of their words. */
    async embed(texts: string[]): Promise<number[][]> {
      calls.push({ task: 'embed' as TaskId, sessionId: '', aborted: false, input: texts as never });
      return texts.map((t) => {
        const v = new Array<number>(256).fill(0);
        for (const w of t.toLowerCase().match(/[a-z']+/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 256, 7)]! += 1;
        return v;
      });
    },
    /** Like `run`, but reports the answer's string fields in order across the delay (the read at 40%, the rest at 70%). */
    async stream<K extends TaskId>(task: K, input: TaskInput<K>, o: StreamOptions): Promise<TaskResult<K>> {
      const delay = opts.delay?.(task) ?? opts.delayMs?.[task] ?? 0;
      const make = (opts.outputs?.[task] ?? defaults[task]) as (i: TaskInput<K>) => TaskOutput<K>;
      const peek = opts.fail?.[task] ? null : make(input);
      const fields = peek ? Object.fromEntries(Object.entries(peek as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
      const keys = Object.keys(fields);
      const split = Math.max(1, keys.indexOf('say'));
      const timers: ReturnType<typeof setTimeout>[] = [];
      if (o.onFields && keys.length) {
        timers.push(setTimeout(() => o.onFields!(Object.fromEntries(keys.slice(0, split).map((k) => [k, fields[k]!]))), delay * 0.4));
        timers.push(setTimeout(() => o.onFields!(fields), delay * 0.7));
      }
      try {
        return await client.run(task, input, o);
      } finally {
        for (const t of timers) clearTimeout(t);
      }
    },
  };
  return client;
}

export function testServer(o: { mubit?: MubitClient | null; config?: Partial<ServerConfig>; env?: Record<string, string>; fetch?: typeof fetch } & Pick<BootOptions, 'now' | 'rng'> = {}): CueServer {
  const mubit = o.mubit === undefined ? fakeMubit() : o.mubit;
  return boot({
    env: o.env ?? {},
    // Standby writes are off by default here so call counts stay exact; latency.test.ts turns them on.
    config: { dbPath: ':memory:', heartbeatMs: 40, latency: { ...loadConfig({}).latency, standby: 0 }, ...o.config },
    mubit,
    ...(mubit && 'sent' in mubit ? { sent: (mubit as FakeMubit).sent } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    rng: o.rng ?? seeded(42),
    ...(o.now ? { now: o.now } : {}),
    log: { info() {}, warn() {}, error() {} },
  });
}

/** mulberry32 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROSPECT = { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', facts: { funding: 'Series A in March', product: 'AI copilot for clinics' } };
export const REP = { id: 'rep_alex', name: 'Alex' };

export async function json<T = any>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

export function post(server: CueServer, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return server.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
}

export async function createCall(server: CueServer, extra: Record<string, unknown> = {}): Promise<string> {
  const v = await json(post(server, '/api/calls', { prospect: PROSPECT, rep: REP, ...extra }));
  return v.id as string;
}

export function types(events: CallEvent[]): string[] {
  return events.map((e) => e.type);
}
