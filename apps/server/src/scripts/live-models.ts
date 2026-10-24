/**
 * Which model answers live_cue fastest through Mubit: time to the line on screen (the `say` field
 * complete in the stream) and to the whole answer, per model, on the same turns.
 *
 *   pnpm --filter @cue/server exec tsx --env-file=../../.env src/scripts/live-models.ts gpt-4o-mini gpt-4.1-mini
 */
import { performance } from 'node:perf_hooks';
import { createMubit, loadMubitConfig } from '@cue/mubit';
import type { LiveCueInput } from '@cue/core';
import { SEED_PLAYBOOK } from '../adapters/core';

const models = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 4);

const playbook: LiveCueInput['playbook'] = SEED_PLAYBOOK.slice(0, 26).map((l) => ({ line_id: l.id, moment: l.moment, style: l.style, text: l.text, used: l.stats['*']?.used ?? 0, wins: l.stats['*']?.stepWins ?? 0, booked: l.stats['*']?.booked ?? 0 }));
const base = {
  prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs' },
  rep: { name: 'Nick', company: 'Corgi' },
  brief: { summary: 'AI document review for mid-size law firms; seed stage, 14 people, London and New York.', opener: "I saw you're reviewing contracts for law firms with AI.", risk: 'Wrong answers in client contract reviews.', policies: ['Technology E&O: AI errors in client work', 'Cyber: client documents'], facts: ['Form D verified: Round still open — $1.3M of $9.9M left'] },
  playbook,
  previous: { persona: 'ceo' as const, receptivity: 'neutral' as const, moment: 'opener' as const },
  already_said: [],
};
const turns: LiveCueInput['transcript'][] = [
  [{ speaker: 'rep', text: "Hey Maya, this is Nick from Corgi. I'll be honest, this is a cold call, but a researched one." }, { speaker: 'prospect', text: "...yeah. What's this regarding." }],
  [{ speaker: 'rep', text: 'Insurance, honestly. Thirty seconds?' }, { speaker: 'prospect', text: 'We already have a broker for all that, so I think we are fine.' }],
  [{ speaker: 'rep', text: 'When did they last re-quote you after the raise?' }, { speaker: 'prospect', text: 'Huh, not sure. What would something like that even cost us?' }],
  [{ speaker: 'rep', text: 'Fair.' }, { speaker: 'prospect', text: "I'm about to jump into a meeting, can you just email me something?" }],
];

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]!;

for (const model of models) {
  const client = createMubit(loadMubitConfig({ ...process.env, CUE_LIVE_PROVIDER: 'openai', CUE_LIVE_MODEL: model }));
  const sayMs: number[] = [];
  const doneMs: number[] = [];
  let failed = '';
  for (let i = 0; i < runs; i++) {
    for (const transcript of turns) {
      const t0 = performance.now();
      let say = 0;
      try {
        const r = await client.stream('live_cue', { ...base, transcript }, { sessionId: `bench_${model}_${i}`, timeoutMs: 8000, onFields: (f) => { if (f.say !== undefined && !say) say = performance.now() - t0; } });
        doneMs.push(performance.now() - t0);
        sayMs.push(say || performance.now() - t0);
        if (i === 0) console.log(`  ${model} · ${r.output.moment.padEnd(22)} ${r.output.say}`);
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    if (failed) break;
  }
  if (failed) console.log(`${model}: FAILED ${failed.slice(0, 200)}`);
  else console.log(`${model}: line on screen p50 ${Math.round(pct(sayMs, 0.5))} ms, p90 ${Math.round(pct(sayMs, 0.9))} ms · full answer p50 ${Math.round(pct(doneMs, 0.5))} ms (n=${sayMs.length})`);
}
