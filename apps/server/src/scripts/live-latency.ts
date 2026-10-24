/**
 * End-to-end latency of a deployed Cue server, measured from the rep's side of the wire:
 * prospect stops talking → the card arrives over SSE. Replays the cold-call scripts in real time
 * with Deepgram-style interims (words at speaking pace, an interim every 250 ms carrying the words
 * spoken up to 200 ms earlier, a punctuated final 450 ms after the end of speech).
 *
 *   pnpm --filter @cue/server latency:live -- --url=https://…modal.run [--scripts=demo,objections] [--token=…]
 *
 * The token defaults to CUE_API_TOKEN (from .env or .env.modal). Writes docs/perf/live-latency-<date>.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SIM_SCRIPTS, type SimScript } from './latency-scripts';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k!, v.join('=') || '1']; }));
const ROOT = resolve(import.meta.dirname, '../../../..');

function envToken(): string {
  if (process.env.CUE_API_TOKEN) return process.env.CUE_API_TOKEN;
  try {
    return /CUE_API_TOKEN=(\S+)/.exec(readFileSync(resolve(ROOT, '.env.modal'), 'utf8'))?.[1] ?? '';
  } catch {
    return '';
  }
}

const URL_ = (args.url ?? process.env.CUE_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const TOKEN = args.token ?? envToken();
const WPS = Number(args.wps ?? 2.6);
const INTERIM_MS = Number(args['interim-ms'] ?? 250);
const STT_LAG_MS = Number(args['stt-lag'] ?? 200);
const FINAL_DELAY_MS = Number(args['final-delay'] ?? 450);
const REP_REACT_MS = Number(args['rep-react'] ?? 900);
const wanted = args.scripts ? String(args.scripts).split(',') : ['demo', 'objections', 'brushoffs'];
const scripts = SIM_SCRIPTS.filter((s) => wanted.includes(s.id));

const headers = { 'content-type': 'application/json', 'x-cue-token': TOKEN };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rid = () => `turn_lat${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function api(path: string, body?: unknown, method = 'POST') {
  const res = await fetch(`${URL_}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

interface Card { at: number; say: string; moment: string; servedBy: string; predicted: boolean }
interface Sse { cards: Map<string, Card[]>; skips: Map<string, string>; turnSeen: Map<string, number>; errors: string[]; close: () => void }

/** Follows the call's SSE stream and timestamps each card (by prospect turn id) as it arrives here. */
async function follow(callId: string): Promise<Sse> {
  const ctl = new AbortController();
  const res = await fetch(`${URL_}/api/calls/${callId}/stream?token=${encodeURIComponent(TOKEN)}`, { signal: ctl.signal });
  if (!res.ok || !res.body) throw new Error(`stream: ${res.status}`);
  const out: Sse = { cards: new Map(), skips: new Map(), turnSeen: new Map(), errors: [], close: () => ctl.abort() };
  void (async () => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          const at = performance.now();
          const msg = JSON.parse(data);
          const e = msg.event ?? (msg.kind === 'event' ? msg.event : null);
          if (!e) continue;
          if (e.type === 'suggestion.shown') {
            const list = out.cards.get(e.suggestion.turnId) ?? [];
            list.push({ at, say: e.suggestion.say, moment: e.suggestion.situation.moment, servedBy: e.suggestion.servedBy, predicted: e.suggestion.precomputed === 'predicted' });
            out.cards.set(e.suggestion.turnId, list);
          } else if (e.type === 'suggestion.skipped') out.skips.set(e.turnId, e.reason);
          else if (e.type === 'turn.added' && !out.turnSeen.has(e.turn.id)) out.turnSeen.set(e.turn.id, at);
          else if (e.type === 'pipeline.error') out.errors.push(`${e.stage}: ${e.message}`);
        }
      }
    } catch {
      /* closed */
    }
  })();
  return out;
}

interface TurnResult { script: string; text: string; expect?: string; endOfSpeech: number; readyMs: number | null; finalMs: number | null; moment: string | null; say: string | null; versions: number; skipped: string | null; predicted?: boolean }

async function speak(callId: string, speaker: 'prospect' | 'rep', text: string, transport: number[], sse: Sse): Promise<{ id: string; end: number }> {
  const words = text.split(/\s+/);
  const start = performance.now();
  const durMs = (words.length / WPS) * 1000;
  const id = rid();
  if (speaker === 'prospect') {
    // Interims while they talk: the words spoken up to STT_LAG_MS ago.
    for (let t = INTERIM_MS; t < durMs + STT_LAG_MS; t += INTERIM_MS) {
      await sleep(start + t - performance.now());
      const heard = Math.floor(((t - STT_LAG_MS) / 1000) * WPS);
      if (heard <= 0) continue;
      const partial = words.slice(0, Math.min(words.length, heard)).join(' ');
      const done = heard >= words.length;
      void api(`/api/calls/${callId}/turns`, { id, speaker, text: done ? text : partial.replace(/[.?!,]$/, ''), final: false, via: 'deepgram' }).catch(() => {});
    }
  } else await sleep(durMs);
  const end = start + durMs;
  await sleep(end + (speaker === 'prospect' ? FINAL_DELAY_MS : 0) - performance.now());
  const sent = performance.now();
  await api(`/api/calls/${callId}/turns`, { id, speaker, text, final: true, via: 'deepgram' });
  if (speaker === 'rep') {
    const seen = sse.turnSeen.get(id);
    if (seen) transport.push(seen - sent);
  }
  return { id, end };
}

async function runScript(s: SimScript, transport: number[]): Promise<TurnResult[]> {
  const call = await api('/api/calls', { prospect: s.prospect, rep: s.rep, clientBrief: true });
  const sse = await follow(call.id);
  await sleep(300);
  const results: TurnResult[] = [];
  let lastEnd = performance.now();
  for (const line of s.lines) {
    await sleep(lastEnd + (line.gapMs ?? (line.speaker === 'rep' ? REP_REACT_MS : 600)) - performance.now());
    const { id, end } = await speak(call.id, line.speaker, line.text, transport, sse);
    lastEnd = end;
    if (line.speaker === 'prospect') results.push({ script: s.id, text: line.text, ...(line.expect ? { expect: line.expect } : {}), endOfSpeech: end, readyMs: null, finalMs: null, moment: null, say: null, versions: 0, skipped: null, id } as TurnResult & { id: string });
  }
  await sleep(4000);
  for (const r of results as (TurnResult & { id: string })[]) {
    const cards = sse.cards.get(r.id) ?? [];
    r.versions = cards.length;
    r.skipped = sse.skips.get(r.id) ?? null;
    if (cards.length) {
      r.readyMs = Math.max(0, Math.round(cards[0]!.at - r.endOfSpeech));
      r.finalMs = Math.round(cards.at(-1)!.at - r.endOfSpeech);
      r.moment = cards.at(-1)!.moment;
      r.say = cards.at(-1)!.say;
      r.predicted = !!cards[0]!.predicted;
    }
  }
  if (sse.errors.length) console.log(`  errors: ${[...new Set(sse.errors)].slice(0, 3).join(' | ')}`);
  await api(`/api/calls/${call.id}/end`, {});
  sse.close();
  return results;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};

async function main() {
  const health = await (await fetch(`${URL_}/health`)).json();
  console.log(`server ${URL_} · pipeline ${health.pipeline} · mubit ${health.mubit.configured ? `on (${health.mubit.models.live ?? health.mubit.models.write})` : 'OFF'}`);
  const transport: number[] = [];
  const all: TurnResult[] = [];
  for (const s of scripts) {
    console.log(`- ${s.title}`);
    all.push(...(await runScript(s, transport)));
  }
  const ready = all.filter((r) => r.readyMs !== null).map((r) => r.readyMs!);
  const expected = all.filter((r) => r.expect);
  const right = expected.filter((r) => r.moment === r.expect).length;
  const summary = {
    at: new Date().toISOString(),
    url: URL_,
    pipeline: health.pipeline,
    model: health.mubit.models.live ?? null,
    turns: all.length,
    cards: ready.length,
    readyP50: pct(ready, 0.5),
    readyP95: pct(ready, 0.95),
    /** Turns whose first card was a line pre-written for a predicted reply. */
    predicted: all.filter((r) => r.predicted).length,
    under600: ready.length ? Math.round((ready.filter((x) => x < 600).length / ready.length) * 100) : null,
    transportP50: pct(transport, 0.5),
    momentAccuracy: expected.length ? Math.round((right / expected.length) * 100) : null,
  };
  for (const r of all) console.log(`  ${String(r.readyMs ?? '—').padStart(5)} ms ${r.predicted ? '*' : ' '} ${(r.moment ?? r.skipped ?? '').padEnd(24)} ${r.text.slice(0, 60)}${r.say ? `  →  ${r.say.slice(0, 70)}` : ''}`);
  console.log(JSON.stringify(summary, null, 2));
  const file = resolve(ROOT, `docs/perf/live-latency-${summary.at.slice(0, 10)}${args.label ? `-${args.label}` : ''}.json`);
  writeFileSync(file, JSON.stringify({ summary, turns: all }, null, 2));
  console.log(`wrote ${file}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
