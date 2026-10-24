import { PlaybookLine, type LineStats } from '@cue/core';
import { SEED_PLAYBOOK } from '../adapters/core';
import { tx, type Db } from './db';

/** Per-call contribution to the playbook, kept so a re-review can replace (not add to) it. */
export interface AppliedReview {
  /** lineId → situation key → stats delta. */
  stats: Record<string, Record<string, LineStats>>;
  /** Candidate line ids mined from this call. */
  candidates: string[];
}

export class PlaybookStore {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM playbook_lines').get() as { n: number }).n;
    if (n === 0) this.save(SEED_PLAYBOOK);
  }

  all(): PlaybookLine[] {
    const rows = this.db.prepare('SELECT json FROM playbook_lines ORDER BY id').all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as PlaybookLine);
  }

  active(): PlaybookLine[] {
    return this.all().filter((l) => l.status === 'active');
  }

  get(id: string): PlaybookLine | null {
    const r = this.db.prepare('SELECT json FROM playbook_lines WHERE id = ?').get(id) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as PlaybookLine) : null;
  }

  save(lines: PlaybookLine[]): void {
    const at = this.now();
    tx(this.db, () => {
      const stmt = this.db.prepare('INSERT INTO playbook_lines (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
      for (const l of lines) stmt.run(l.id, JSON.stringify(PlaybookLine.parse(l)), at);
    });
  }

  remove(ids: string[]): void {
    const stmt = this.db.prepare('DELETE FROM playbook_lines WHERE id = ?');
    tx(this.db, () => ids.forEach((id) => stmt.run(id)));
  }

  updatedAt(): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(updated_at), 0) AS t FROM playbook_lines').get() as { t: number };
    return r.t;
  }

  applied(callId: string): AppliedReview | null {
    const r = this.db.prepare('SELECT json FROM playbook_applied WHERE call_id = ?').get(callId) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as AppliedReview) : null;
  }

  setApplied(callId: string, a: AppliedReview): void {
    this.db.prepare('INSERT INTO playbook_applied (call_id, json, at) VALUES (?, ?, ?) ON CONFLICT(call_id) DO UPDATE SET json = excluded.json, at = excluded.at').run(callId, JSON.stringify(a), this.now());
  }
}
