import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The server's one SQLite file (node:sqlite, no native build). Migrations are append-only: add a new
 * entry at the end, never edit a shipped one.
 */
const MIGRATIONS: string[] = [
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
