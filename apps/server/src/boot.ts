import type { Hono } from 'hono';
import { loadConfig, type ServerConfig } from './config';
import { createMubit, loadMubitConfig, type MubitClient } from './adapters/mubit';
import { createApp } from './http/app';
import { StreamRegistry } from './http/sse';
import { createLogger, type Logger, type Services } from './services/context';
import { Cue } from './services/cue';
import { ModelRunner } from './services/models';
import { PolicyChecker } from './services/policy';
import { SentTracker, type SentCounter } from './services/sent';
import { openDb } from './store/db';
import { EventStore } from './store/events';
import { PlaybookStore } from './store/playbook';
import { TelemetryStore } from './store/telemetry';

export interface BootOptions {
  config?: Partial<ServerConfig>;
  env?: Record<string, string | undefined>;
  /** Inject a fake (tests) or `null` to force the rules engine. Default: the real client when a key is set. */
  mubit?: MubitClient | null;
  fetch?: typeof fetch;
  now?: () => number;
  rng?: () => number;
  log?: Logger;
  /** With an injected `mubit`, how to tell whether a cancelled run was really sent. */
  sent?: SentCounter;
}

export interface CueServer {
  config: ServerConfig;
  cue: Cue;
  app: Hono;
  streams: StreamRegistry;
  /** Starts the Trellus poller and the auto-review sweep. */
  startBackground(): void;
  close(): Promise<void>;
}

export function boot(opts: BootOptions = {}): CueServer {
  const env = opts.env ?? process.env;
  const config: ServerConfig = { ...loadConfig(env), ...opts.config };
  const mubitConfig = loadMubitConfig(env);
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetch ?? fetch;
  const tracker = new SentTracker();
  const mubit = opts.mubit !== undefined ? opts.mubit : mubitConfig.configured ? createMubit(mubitConfig, { fetch: tracker.wrap(fetchImpl), now }) : null;

  const db = openDb(config.dbPath);
  const telemetry = new TelemetryStore(db);
  const models = new ModelRunner(mubit, telemetry, mubitConfig.models, now, opts.mubit !== undefined ? (opts.sent ?? null) : tracker);
  const s: Services = {
    config,
    db,
    store: new EventStore(db, now),
    playbook: new PlaybookStore(db, now),
    telemetry,
    models,
    policy: new PolicyChecker(models, { saplingUrl: config.saplingUrl, budgetMs: config.budgets.checkMs, fetch: fetchImpl }),
    log: opts.log ?? createLogger(),
    now,
    rng: opts.rng ?? Math.random,
    fetch: fetchImpl,
  };
  const cue = new Cue(s);
  const streams = new StreamRegistry();
  const app = createApp(cue, streams);
  let sweep: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  return {
    config,
    cue,
    app,
    streams,
    startBackground() {
      cue.trellus.start();
      void models.ping();
      sweep = setInterval(() => cue.reviews.sweep(), 60_000);
      sweep.unref();
    },
    async close() {
      if (closed) return;
      closed = true;
      if (sweep) clearInterval(sweep);
      cue.trellus.stop();
      streams.closeAll();
      await Promise.race([cue.idle(), new Promise((r) => setTimeout(r, 5000).unref())]);
      db.close();
    },
  };
}
