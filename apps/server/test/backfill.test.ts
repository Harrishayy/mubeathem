import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/store/db';

const call = (db: DatabaseSync, id: number, requestId: string | null, session: string, at: number, errorCode: string | null = null) =>
  db
    .prepare('INSERT INTO mubit_calls (id, request_id, task, model, session_id, ok, latency_ms, in_tok, out_tok, cost_usd, at, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, requestId, 'write_line', 'gpt-4.1-mini', session, errorCode ? 0 : 1, 1200, 2500, 110, 0.0012, at, errorCode);

describe('trace backfill migration', () => {
  it('turns every pre-trace Mubit call into one metadata-only trace, linked, without duplicating live traces', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]!);
    db.exec(MIGRATIONS[1]!);
    call(db, 1, 'mreq_a', 'call_1', 1_000);
    call(db, 2, null, 'seed_claim_x', 2_000);
    call(db, 3, 'mreq_c', 'call_2', 3_000, 'aborted');
    call(db, 4, 'mreq_live', 'call_3', 9_000); // also traced live below
    db.prepare('INSERT INTO mubit_links (request_id, call_id, suggestion_id, task) VALUES (?, ?, ?, ?)').run('mreq_a', 'call_1', 'sug_1', 'write_line');
    db.prepare("INSERT INTO mubit_traces (id, request_id, task, model, session_id, ok, latency_ms, at, instructions_version) VALUES ('trc_live', 'mreq_live', 'write_line', 'gpt-4.1-mini', 'call_3', 1, 900, 9000, 2)").run();

    db.exec(MIGRATIONS[2]!);
    const rows = db.prepare('SELECT id, request_id AS req, call_id AS callId, suggestion_id AS sug, aborted, instructions_version AS v, input_json AS input FROM mubit_traces ORDER BY at').all() as Record<string, unknown>[];
    expect(rows.map((r) => r.id)).toEqual(['trc_bf1', 'trc_bf2', 'trc_bf3', 'trc_live']);
    expect(rows[0]).toMatchObject({ callId: 'call_1', sug: 'sug_1', v: 0, input: null, aborted: 0 });
    expect(rows[1]).toMatchObject({ callId: null, sug: null });
    expect(rows[2]).toMatchObject({ aborted: 1 });
  });
});
