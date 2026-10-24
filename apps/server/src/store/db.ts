import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The server's one SQLite file (node:sqlite, no native build). Migrations are append-only: add a new
 * entry at the end, never edit a shipped one.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE calls (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     source TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     prospect_json TEXT NOT NULL,
     rep_json TEXT NOT NULL,
     trellus_session_id TEXT,
     outcome TEXT,
     practice_json TEXT,
     has_feedback INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX calls_started ON calls(started_at DESC);
   CREATE INDEX calls_trellus ON calls(trellus_session_id);
   CREATE TABLE events (
     call_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     type TEXT NOT NULL,
     at INTEGER NOT NULL,
     json TEXT NOT NULL,
     PRIMARY KEY (call_id, seq)
   );
   CREATE TABLE playbook_lines (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE mubit_calls (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     request_id TEXT,
     task TEXT NOT NULL,
     model TEXT NOT NULL,
     session_id TEXT NOT NULL,
     ok INTEGER NOT NULL,
     latency_ms INTEGER NOT NULL,
     in_tok INTEGER NOT NULL DEFAULT 0,
     out_tok INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0,
     at INTEGER NOT NULL,
     error_code TEXT
   );
   CREATE INDEX mubit_calls_task ON mubit_calls(task, at);
   CREATE TABLE mubit_links (request_id TEXT NOT NULL, call_id TEXT NOT NULL, suggestion_id TEXT, task TEXT NOT NULL);
   CREATE INDEX mubit_links_call ON mubit_links(call_id);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE playbook_applied (call_id TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL);`,
  // 2: full trace of every Mubit call (store/traces.ts). Bodies are JSON text, capped per field.
  `CREATE TABLE mubit_traces (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     request_id TEXT,
     task TEXT NOT NULL,
     model TEXT NOT NULL,
     session_id TEXT NOT NULL,
     call_id TEXT,
     suggestion_id TEXT,
     ok INTEGER NOT NULL,
     error_code TEXT,
     error_message TEXT,
     latency_ms INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     in_tok INTEGER NOT NULL DEFAULT 0,
     out_tok INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0,
     at INTEGER NOT NULL,
     instructions_version INTEGER NOT NULL,
     input_json TEXT,
     output_json TEXT,
     aborted INTEGER NOT NULL DEFAULT 0,
     truncated INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX mubit_traces_at ON mubit_traces(at);
   CREATE INDEX mubit_traces_task_at ON mubit_traces(task, at);
   CREATE INDEX mubit_traces_session ON mubit_traces(session_id);
   CREATE INDEX mubit_traces_request ON mubit_traces(request_id);
   CREATE INDEX mubit_traces_call ON mubit_traces(call_id);`,
  // Backfill: every Mubit call logged before traces existed becomes a metadata-only trace (no bodies,
  // instructions version 0 = unknown, so fine-tune exports skip it), linked to its call and card.
  `INSERT INTO mubit_traces (id, request_id, task, model, session_id, call_id, suggestion_id, ok, error_code, error_message, latency_ms, attempts, in_tok, out_tok, cost_usd, at, instructions_version, input_json, output_json, aborted, truncated)
   SELECT 'trc_bf' || c.id, c.request_id, c.task, c.model, c.session_id,
          CASE WHEN substr(c.session_id, 1, 5) = 'call_' THEN c.session_id END,
          (SELECT l.suggestion_id FROM mubit_links l WHERE l.request_id = c.request_id AND l.suggestion_id IS NOT NULL LIMIT 1),
          c.ok, c.error_code, NULL, c.latency_ms, 0, c.in_tok, c.out_tok, c.cost_usd, c.at, 0, NULL, NULL,
          CASE WHEN c.error_code = 'aborted' THEN 1 ELSE 0 END, 0
   FROM mubit_calls c
   WHERE c.at < COALESCE((SELECT MIN(at) FROM mubit_traces), 9223372036854775807)
     AND (c.request_id IS NULL OR NOT EXISTS (SELECT 1 FROM mubit_traces t WHERE t.request_id = c.request_id));`,
  // 4: who made each call, which saved contact it was, the rep's debrief and cue counts, so history
  // filters and team numbers are plain indexed SQL. Backfilled from the event log.
  `ALTER TABLE calls ADD COLUMN rep_id TEXT;
   ALTER TABLE calls ADD COLUMN rep_name TEXT;
   ALTER TABLE calls ADD COLUMN contact_id TEXT;
   ALTER TABLE calls ADD COLUMN rating INTEGER;
   ALTER TABLE calls ADD COLUMN attitude TEXT;
   ALTER TABLE calls ADD COLUMN cues_shown INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE calls ADD COLUMN cues_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE calls ADD COLUMN impact REAL;
   UPDATE calls SET rep_id = json_extract(rep_json, '$.id'), rep_name = json_extract(rep_json, '$.name');
   UPDATE calls SET
     rating = (SELECT json_extract(e.json, '$.feedback.rating') FROM events e WHERE e.call_id = calls.id AND e.type = 'feedback.submitted' ORDER BY e.seq DESC LIMIT 1),
     attitude = COALESCE(
       (SELECT json_extract(e.json, '$.feedback.attitude') FROM events e WHERE e.call_id = calls.id AND e.type = 'feedback.submitted' ORDER BY e.seq DESC LIMIT 1),
       (SELECT json_extract(e.json, '$.review.customerAttitude') FROM events e WHERE e.call_id = calls.id AND e.type = 'review.completed' ORDER BY e.seq DESC LIMIT 1)),
     impact = (SELECT json_extract(e.json, '$.review.suggestionImpact') FROM events e WHERE e.call_id = calls.id AND e.type = 'review.completed' ORDER BY e.seq DESC LIMIT 1),
     cues_shown = (SELECT COUNT(DISTINCT json_extract(e.json, '$.suggestion.id')) FROM events e WHERE e.call_id = calls.id AND e.type = 'suggestion.shown'),
     cues_used = (SELECT COUNT(DISTINCT json_extract(e.json, '$.suggestionId')) FROM events e WHERE e.call_id = calls.id AND e.type = 'suggestion.action' AND json_extract(e.json, '$.action') IN ('used', 'edited'));
   CREATE INDEX calls_rep ON calls(rep_id, started_at DESC);
   CREATE INDEX calls_contact ON calls(contact_id, started_at DESC);
   CREATE TABLE contacts (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     company TEXT NOT NULL DEFAULT '',
     phone TEXT,
     email TEXT,
     crm_id TEXT,
     facts_json TEXT NOT NULL DEFAULT '{}',
     notes TEXT,
     owner_rep_id TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_called_at INTEGER
   );
   CREATE INDEX contacts_name ON contacts(name COLLATE NOCASE);
   CREATE INDEX contacts_owner ON contacts(owner_rep_id);
   CREATE UNIQUE INDEX contacts_email ON contacts(email COLLATE NOCASE) WHERE email IS NOT NULL;`,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, at INTEGER NOT NULL)');
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM migrations').get() as { v: number };
  for (let v = row.v; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.prepare('INSERT INTO migrations (version, at) VALUES (?, ?)').run(v + 1, Date.now());
    });
  }
}

/** Runs `fn` in a transaction (nesting-safe via savepoints). */
const depths = new WeakMap<Db, number>();
export function tx<T>(db: Db, fn: () => T): T {
  const depth = depths.get(db) ?? 0;
  const name = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depths.set(db, depth + 1);
  try {
    const out = fn();
    depths.set(db, depth);
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return out;
  } catch (e) {
    depths.set(db, depth);
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, Date.now());
}
