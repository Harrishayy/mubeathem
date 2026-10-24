import type { Outcome, OutcomeRecord, TrellusDispositionsResponse } from '@cue/core';
import { newId } from './adapters/core';
import {
  buildDispositionMap,
  createOutcomePoller,
  createTrellusClient,
  importedCallToEvents,
  learnDispositions,
  NATIVE_DISPOSITIONS,
  NativeSource,
  TrellusSource,
  type FetchLike,
  type OutcomePoller,
  type OutcomeSource,
  type TrellusClient,
} from './adapters/trellus';
import { getSetting, setSetting } from './store/db';
import type { Services } from './services/context';

export interface TrellusStatus {
  configured: boolean;
  source: 'trellus' | 'native';
  reachable: boolean | null;
  lastSyncAt: number | null;
  lastError: string | null;
  teamId: string | null;
}

export interface TrellusSyncResult {
  source: 'trellus' | 'native';
  imported: number;
  matched: number;
  skipped: number;
  /** Server-side only (not part of the HTTP response): ids of the calls imported this time. */
  importedIds: string[];
}

const KEY_SETTING = 'trellus.apiKey';
const TEAM_SETTING = 'trellus.teamId';
const OVERRIDES_SETTING = 'trellus.dispositionOverrides';
/** /bootstrap shares a 2 req / 4 s budget; the vocabulary barely changes, so cache it. */
const BOOTSTRAP_TTL_MS = 10 * 60_000;

/**
 * Wires the configured CallSource (Trellus when a key is set in env or settings, else Cue native)
 * and the outcome poller for ended calls that have no outcome yet.
 */
export class TrellusService {
  private source!: OutcomeSource;
  private poller: OutcomePoller | null = null;
  private apiKey = '';
  private teamId = '';
  private lastSyncAt: number | null = null;
  private reachable: boolean | null = null;
  private lastError: string | null = null;
  private client: TrellusClient | null = null;
  private overrides: Record<string, Outcome> = {};
  private bootstrap: { at: number; value: Record<string, unknown> } | null = null;

  constructor(
    private s: Services,
    private onOutcome: (callId: string, outcome: OutcomeRecord) => void,
  ) {
    this.apiKey = getSetting(s.db, KEY_SETTING) ?? s.config.trellus.apiKey;
    this.teamId = getSetting(s.db, TEAM_SETTING) ?? s.config.trellus.teamId;
    try {
      this.overrides = JSON.parse(getSetting(s.db, OVERRIDES_SETTING) ?? '{}') as Record<string, Outcome>;
    } catch {
      this.overrides = {};
    }
    this.build();
  }

  private build(): void {
    this.bootstrap = null;
    this.client = this.apiKey ? createTrellusClient({ apiKey: this.apiKey, teamId: this.teamId || null, fetch: this.s.fetch as FetchLike, now: this.s.now }) : null;
    this.source = this.client
      ? new TrellusSource({ client: this.client, overrides: this.overrides, now: this.s.now })
      : // Cue native: the rep's tap is the outcome; history is already in our own store.
        new NativeSource({ store: () => [] });
  }

  get kind(): 'trellus' | 'native' {
    return this.source.kind;
  }

  status(): TrellusStatus {
    return { configured: !!this.apiKey, source: this.source.kind, reachable: this.reachable, lastSyncAt: this.lastSyncAt, lastError: this.lastError, teamId: this.teamId || null };
  }

  /** The account's disposition vocabulary, the map in use, and what is still unmapped (settings screen). */
  async dispositions(): Promise<TrellusDispositionsResponse> {
    const overrides = { ...this.overrides };
    if (!this.client) {
      const learned = NATIVE_DISPOSITIONS.map((d) => ({ raw: d.label, outcome: overrides[d.label] ?? d.outcome, via: overrides[d.label] ? ('override' as const) : ('default' as const) }));
      const map = { ...buildDispositionMap(null, overrides), ...Object.fromEntries(learned.map((l) => [l.raw, l.outcome])) };
      return { source: 'native', vocabulary: learned.map((l) => l.raw), learned, map, overrides, unmapped: [], error: null };
    }
    let error: string | null = null;
    let bootstrap: Record<string, unknown> | null = null;
    try {
      if (!this.bootstrap || this.s.now() - this.bootstrap.at > BOOTSTRAP_TTL_MS) this.bootstrap = { at: this.s.now(), value: (await this.client.bootstrap()) as Record<string, unknown> };
      bootstrap = this.bootstrap.value;
      this.reachable = true;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : 'Trellus unreachable';
      this.reachable = false;
    }
    const learned = learnDispositions(bootstrap, overrides);
    return {
      source: 'trellus',
      vocabulary: learned.map((l) => l.raw),
      learned,
      map: { ...buildDispositionMap(bootstrap, overrides) },
      overrides,
      unmapped: learned.filter((l) => l.via === 'unmapped').map((l) => l.raw),
      error,
    };
  }

  /** Replaces the manual overrides (stored in settings) and rebuilds the source so polling uses them. */
  async setOverrides(overrides: Record<string, Outcome>): Promise<TrellusDispositionsResponse> {
    const clean = Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k.trim(), v] as const).filter(([k]) => k).slice(0, 200));
    this.overrides = clean;
    setSetting(this.s.db, OVERRIDES_SETTING, JSON.stringify(clean));
    const cached = this.bootstrap;
    const running = !!this.poller;
    this.stop();
    this.build();
    this.bootstrap = cached;
    if (running) this.start();
    return this.dispositions();
  }

  /** Stores the key server-side (settings table). Never echoed back. */
  setKey(apiKey: string, teamId?: string): TrellusStatus {
    this.apiKey = apiKey.trim();
    if (teamId !== undefined) this.teamId = teamId.trim();
    setSetting(this.s.db, KEY_SETTING, this.apiKey);
    setSetting(this.s.db, TEAM_SETTING, this.teamId);
    this.reachable = null;
    this.lastError = null;
    const running = !!this.poller;
    this.stop();
    this.build();
    if (running) this.start();
    return this.status();
  }

  start(): void {
    const sec = this.s.config.trellus.pollSeconds;
    if (this.poller || sec <= 0 || this.source.kind !== 'trellus') return;
    this.poller = createOutcomePoller({
      source: this.source,
      intervalMs: sec * 1000,
      getOpenCalls: () =>
        this.s.store.calls({ where: 'ended_without_outcome', limit: 100 }).map((c) => ({ callId: c.id, startedAt: c.startedAt, ...(c.endedAt ? { endedAt: c.endedAt } : {}), prospect: c.prospect })),
      onOutcome: (callId, outcome) => {
        this.reachable = true;
        this.onOutcome(callId, outcome);
      },
      onError: (err) => {
        this.reachable = false;
        this.lastError = err instanceof Error ? err.message.slice(0, 200) : 'poll failed';
      },
      now: this.s.now,
    });
    this.poller.start();
  }

  /** One poll pass now (tests, and a manual sync). */
  async pollOnce(): Promise<void> {
    await this.poller?.tick();
  }

  stop(): void {
    this.poller?.stop();
    this.poller = null;
  }

  /** Pulls recent sessions (imports new ones) and matches outcomes for ended calls without one. */
  async sync(sinceMs = 24 * 3600_000, limit = 50): Promise<TrellusSyncResult> {
    const result: TrellusSyncResult = { source: this.source.kind, imported: 0, matched: 0, skipped: 0, importedIds: [] };
    if (this.source.kind !== 'trellus') return result;
    try {
      const recent = await this.source.listRecent({ since: this.s.now() - sinceMs, limit });
      for (const c of recent) {
        if (this.s.store.findByTrellusSession(c.trellusSessionId)) {
          result.skipped++;
          continue;
        }
        const events = importedCallToEvents(c, { newId: (p) => newId(p as 'call') });
        for (const e of events) this.s.store.append(e);
        result.imported++;
        result.importedIds.push(events[0]!.callId);
      }
      for (const c of this.s.store.calls({ where: 'ended_without_outcome', limit: 100 })) {
        const o = await this.source.findOutcome({ startedAt: c.startedAt, ...(c.endedAt ? { endedAt: c.endedAt } : {}), prospect: c.prospect });
        if (o) {
          this.onOutcome(c.id, o);
          result.matched++;
        }
      }
      this.reachable = true;
      this.lastError = null;
      this.lastSyncAt = this.s.now();
    } catch (e) {
      this.reachable = false;
      this.lastError = e instanceof Error ? e.message.slice(0, 200) : 'sync failed';
    }
    return result;
  }
}
