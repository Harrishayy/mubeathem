import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { seededRng } from '@cue/core';
import { describe, expect, it } from 'vitest';
import { boot } from '../../src/boot';
import { practiceCall } from '../../src/scripts/practice-run';

const envFile = resolve(import.meta.dirname, '../../../../.env');
if (process.env.MUBIT_LIVE === '1' && existsSync(envFile)) process.loadEnvFile(envFile);
const live = process.env.MUBIT_LIVE === '1' && !!process.env.MUBIT_API_KEY;

/** One practice call end to end against Mubit (cheap models, ≤ 25 Mubit calls). */
describe.skipIf(!live)('live practice call through Mubit', () => {
  it('runs brief → turns → cards → review and stays within 25 Mubit calls', { timeout: 180_000 }, async () => {
    const server = boot({ config: { dbPath: ':memory:' }, log: { info() {}, warn() {}, error: (m, d) => console.error(m, d) } });
    try {
      const result = await practiceCall(server, 1, seededRng(3), { maxProspectTurns: 4 });
      await server.cue.idle();
      const { cue } = server;
      const view = cue.getCall(result.callId);
      const rows = cue.s.db.prepare('SELECT task, ok, latency_ms AS ms, request_id AS id, error_code AS err FROM mubit_calls WHERE session_id = ? ORDER BY id').all(result.callId) as { task: string; ok: number; ms: number; id: string | null; err: string | null }[];

      console.log(`\ncall ${result.callId} · ${result.scenario} · ${result.turns} prospect turns · ${result.cards} cards · ${result.used} used · ${result.outcome}`);
      console.log('\nper turn (ms):  read   write  check  total  read-by write-by path        outcome');
      for (const t of cue.turns.recentTimings(result.callId))
        console.log(`  ${t.turnId.slice(-8)}   ${String(t.readMs ?? '-').padEnd(6)} ${String(t.writeMs ?? '-').padEnd(6)} ${String(t.checkMs ?? '-').padEnd(6)} ${String(t.totalMs).padEnd(6)} ${String(t.read ?? '-').padEnd(7)} ${String(t.write ?? '-').padEnd(8)} ${String(t.path ?? '-').padEnd(11)} ${t.outcome}`);
      console.log('\nMubit calls:');
      for (const r of rows) console.log(`  ${r.task.padEnd(18)} ${r.ok ? 'ok ' : 'ERR'} ${String(r.ms).padStart(5)} ms  ${r.id ?? r.err}`);
      const lat = view.history.filter((h) => h.suggestion.kind === 'line').map((h) => h.suggestion.latencyMs).sort((a, b) => a - b);
      console.log(`\nturn → card latency: ${lat.join(', ')} ms; p50 ${lat[Math.floor(lat.length / 2)] ?? '-'} ms`);
      console.log('cards:');
      for (const h of view.history) console.log(`  [${h.suggestion.situation.moment} · ${h.suggestion.servedBy} · ${h.suggestion.writePath ?? '-'}] ${h.suggestion.say}  (${h.suggestion.evidence.text})`);
      console.log(`review: ${view.review?.summary}`);

      expect(rows.length).toBeLessThanOrEqual(25);
      expect(rows.some((r) => r.task === 'research_brief' && r.ok)).toBe(true);
      expect(rows.some((r) => r.task === 'read_moment' && r.ok && r.id?.startsWith('mreq_'))).toBe(true);
      expect(view.brief?.servedBy).toBe('mubit');
      expect(view.history.length).toBeGreaterThan(0);
      expect(view.status).toBe('reviewed');
    } finally {
      await server.close();
    }
  });
});
