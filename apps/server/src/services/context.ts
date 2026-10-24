import type { ServerConfig } from '../config';
import type { EventStore } from '../store/events';
import type { PlaybookStore } from '../store/playbook';
import type { TelemetryStore } from '../store/telemetry';
import type { TraceStore } from '../store/traces';
import type { Db } from '../store/db';
import type { ModelRunner } from './models';
import type { PolicyChecker } from './policy';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Everything a pipeline stage needs, passed explicitly so tests can swap any part. */
export interface Services {
  config: ServerConfig;
  db: Db;
  store: EventStore;
  playbook: PlaybookStore;
  telemetry: TelemetryStore;
  /** Full trace of every Mubit call (buffered; never blocks the pipeline). */
  traces: TraceStore;
  models: ModelRunner;
  policy: PolicyChecker;
  log: Logger;
  now: () => number;
  rng: () => number;
  fetch: typeof fetch;
}

export function createLogger(level: string = process.env.CUE_LOG ?? 'info'): Logger {
  const silent = level === 'silent';
  const out = (lvl: string, msg: string, data?: Record<string, unknown>) => {
    if (silent || (level === 'error' && lvl !== 'error') || (level === 'warn' && lvl === 'info')) return;
    const line = `[cue] ${lvl} ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
    (lvl === 'error' ? console.error : console.log)(line);
  };
  return { info: (m, d) => out('info', m, d), warn: (m, d) => out('warn', m, d), error: (m, d) => out('error', m, d) };
}

/** Clips to a schema max length, on a word boundary when it can. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

/** Keeps the tail of a long utterance: the end of a turn is what the moment is about. */
export function clipTail(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : '…' + t.slice(t.length - (max - 1));
}
