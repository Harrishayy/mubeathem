import type { MubitTrace, TraceExportQuery } from '@cue/core';
import { TASKS } from '../adapters/mubit';
import { rangeSince, type TraceStore } from '../store/traces';

/** Content type and file extension per export format. */
export const EXPORT_FORMATS = {
  jsonl: { contentType: 'application/x-ndjson; charset=utf-8', ext: 'jsonl' },
  openai: { contentType: 'application/x-ndjson; charset=utf-8', ext: 'openai.jsonl' },
  langfuse: { contentType: 'application/json; charset=utf-8', ext: 'langfuse.json' },
} as const;

export function exportFilename(q: TraceExportQuery, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `cue-traces-${q.task ?? 'all'}-${q.range}-${stamp}.${EXPORT_FORMATS[q.format].ext}`;
}

/**
 * Traces as text chunks, oldest first, read page by page. The same code path serves
 * `GET /api/traces/export` (streamed) and `pnpm --filter @cue/server traces:export` (to a file).
 *
 * - `jsonl`: one `MubitTrace` per line.
 * - `openai`: chat fine-tuning rows `{messages: [system, user, assistant]}` for successful calls whose
 *   bodies were kept whole and whose instructions version is the current one (older instructions are
 *   not stored, so those rows are skipped rather than paired with the wrong prompt).
 * - `langfuse`: one ingestion batch `{batch: [...]}`: a `trace-create` per Mubit session (phone call)
 *   and a `generation-create` per Mubit call.
 */
export function* exportTraces(store: TraceStore, q: TraceExportQuery, now: number): Generator<string> {
  const since = rangeSince(q.range, now);
  if (q.format === 'jsonl') {
    for (const t of store.iterate({ since, task: q.task })) yield JSON.stringify(t) + '\n';
    return;
  }
  if (q.format === 'openai') {
    for (const t of store.iterate({ since, task: q.task, okOnly: true })) {
      const row = openaiRow(t);
      if (row) yield JSON.stringify(row) + '\n';
    }
    return;
  }
  yield '{"batch":[';
  let first = true;
  const sessions = new Set<string>();
  for (const t of store.iterate({ since, task: q.task })) {
    for (const ev of langfuseEvents(t, sessions)) {
      yield (first ? '\n' : ',\n') + JSON.stringify(ev);
      first = false;
    }
  }
  yield '\n]}\n';
}

export function openaiRow(t: MubitTrace): { messages: { role: 'system' | 'user' | 'assistant'; content: string }[] } | null {
  const def = TASKS[t.task];
  if (!t.ok || t.truncated || t.input == null || t.output == null || !def || def.version !== t.instructionsVersion) return null;
  return {
    messages: [
      { role: 'system', content: def.instructions },
      { role: 'user', content: JSON.stringify(t.input) },
      { role: 'assistant', content: JSON.stringify(t.output) },
    ],
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
export const langfuseTraceId = (sessionId: string) => `cue-${sessionId}`;

/** Langfuse ingestion events for one trace; the session's `trace-create` comes first, once. */
export function langfuseEvents(t: MubitTrace, seen: Set<string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const traceId = langfuseTraceId(t.sessionId);
  const start = t.at - t.latencyMs;
  if (!seen.has(t.sessionId)) {
    seen.add(t.sessionId);
    out.push({
      id: `${traceId}-create`,
      type: 'trace-create',
      timestamp: iso(start),
      body: { id: traceId, timestamp: iso(start), name: t.callId ? 'cue.call' : 'cue.session', sessionId: t.sessionId, metadata: { callId: t.callId, source: 'cue' } },
    });
  }
  out.push({
    id: `${t.id}-create`,
    type: 'generation-create',
    timestamp: iso(t.at),
    body: {
      id: t.id,
      traceId,
      name: t.task,
      startTime: iso(start),
      endTime: iso(t.at),
      model: t.model,
      input: t.input,
      output: t.output,
      usage: { input: t.inputTokens, output: t.outputTokens, total: t.inputTokens + t.outputTokens, unit: 'TOKENS' },
      usageDetails: { input: t.inputTokens, output: t.outputTokens },
      costDetails: { total: t.costUsd },
      level: t.ok ? 'DEFAULT' : t.aborted ? 'WARNING' : 'ERROR',
      statusMessage: t.ok ? null : `${t.errorCode ?? 'error'}: ${t.errorMessage ?? ''}`.trim(),
      version: String(t.instructionsVersion),
      metadata: { requestId: t.requestId, suggestionId: t.suggestionId, callId: t.callId, attempts: t.attempts, aborted: t.aborted, truncated: !!t.truncated },
    },
  });
  return out;
}
