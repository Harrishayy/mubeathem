import type { CallEvent, TaskId, TaskInput, TaskOutput } from '@cue/core';
import { findRiskyClaims, rulesReadMoment } from '@cue/core';
import { boot, type BootOptions, type CueServer } from '../src/boot';
import type { MubitClient, RunOptions, TaskResult } from '../src/adapters/mubit';
import type { ServerConfig } from '../src/config';
import { rulesProspect } from '../src/pipeline/practice';
import { SentTracker } from '../src/services/sent';

export type FakeFailure = 'timeout' | 'bad_output' | 'http' | 'hang';

export interface FakeMubitOptions {
  delayMs?: Partial<Record<TaskId, number>>;
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
  };

  const sent = new SentTracker();
  const client: FakeMubit = {
    sent,
    calls,
    count: (task) => (task ? calls.filter((c) => c.task === task).length : calls.length),
    async run<K extends TaskId>(task: K, input: TaskInput<K>, o: RunOptions): Promise<TaskResult<K>> {
      const entry = { task, sessionId: o.sessionId, aborted: false, input };
      calls.push(entry);
      sent.mark(o.sessionId, task);
      const failure = opts.fail?.[task];
      try {
        if (failure === 'hang') await sleep(60_000, o.signal);
        await sleep(opts.delayMs?.[task] ?? 0, o.signal);
      } catch (e) {
        entry.aborted = true;
        throw e;
      }
      if (failure === 'timeout') throw Object.assign(new Error('timed out'), { code: 'timeout', status: null, retryable: true, requestId: null });
      if (failure === 'bad_output') throw Object.assign(new Error('output failed schema'), { code: 'bad_output', status: 200, retryable: false, requestId: `mreq_bad_${++n}` });
      if (failure === 'http') throw Object.assign(new Error('upstream 500'), { code: 'http', status: 500, retryable: true, requestId: null });
      const make = (opts.outputs?.[task] ?? defaults[task]) as (i: TaskInput<K>) => TaskOutput<K>;
      return { output: make(input), requestId: `mreq_fake_${++n}`, latencyMs: opts.delayMs?.[task] ?? 1, model: 'gpt-4o-mini', usage: { input: 100, output: 20 }, costUsd: 0.00003, attempts: 1 };
    },
  };
  return client;
}

export function testServer(o: { mubit?: MubitClient | null; config?: Partial<ServerConfig>; env?: Record<string, string>; fetch?: typeof fetch } & Pick<BootOptions, 'now' | 'rng'> = {}): CueServer {
  const mubit = o.mubit === undefined ? fakeMubit() : o.mubit;
  return boot({
    env: o.env ?? {},
    config: { dbPath: ':memory:', heartbeatMs: 40, ...o.config },
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
