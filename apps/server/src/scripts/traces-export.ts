/**
 * `pnpm --filter @cue/server traces:export [--format jsonl|openai|langfuse] [--range 24h|7d|30d|all] [--task <task>] [--db <path>] [--out <file>]`
 *
 * Writes the server's Mubit traces to ./exports/ (relative to the cwd; apps/server under pnpm --filter)
 * with the same code as `GET /api/traces/export`. Reads the store directly, so the server can keep running.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { TraceExportQuery } from '@cue/core';
import { loadMubitConfig } from '../adapters/mubit';
import { expandPath, loadConfig } from '../config';
import { exportFilename, exportTraces } from '../services/trace-export';
import { openDb } from '../store/db';
import { TraceStore } from '../store/traces';

function parseArgs(argv: string[]): { query: Record<string, string>; db: string | null; out: string | null } {
  const query: Record<string, string> = {};
  let db: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i]!.split('=', 2) as [string, string | undefined];
    const v = () => inline ?? argv[++i] ?? '';
    if (k === '--format') query.format = v();
    else if (k === '--range') query.range = v();
    else if (k === '--task') query.task = v();
    else if (k === '--db') db = v();
    else if (k === '--out') out = v();
    else if (k === '--help' || k === '-h') {
      console.log('traces:export [--format jsonl|openai|langfuse] [--range 24h|7d|30d|all] [--task <task>] [--db <path>] [--out <file>]');
      process.exit(0);
    }
  }
  return { query, db, out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
  const parsed = TraceExportQuery.safeParse(args.query);
  if (!parsed.success) {
    console.error(`[cue] bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    process.exit(2);
  }
  const q = parsed.data;
  const config = loadConfig();
  const dbPath = args.db ? expandPath(args.db) : config.dbPath;
  const db = openDb(dbPath);
  const store = new TraceStore(db, { record: loadMubitConfig().record, maxBodyBytes: config.traces.maxBodyBytes });
  const now = Date.now();
  const file = resolve(args.out ?? `exports/${exportFilename(q, now)}`);
  mkdirSync(dirname(file), { recursive: true });
  const out = createWriteStream(file);
  let bytes = 0;
  for (const chunk of exportTraces(store, q, now)) {
    bytes += Buffer.byteLength(chunk);
    if (!out.write(chunk)) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
  db.close();
  console.log(`[cue] ${q.format} export (${q.task ?? 'all tasks'}, ${q.range}) → ${file} (${bytes} bytes) from ${dbPath}`);
}

main().catch((e) => {
  console.error(`[cue] export failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
