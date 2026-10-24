/**
 * One live call per task through Mubit, with realistic demo inputs.
 *
 *   tsx --env-file=../../.env scripts/smoke.ts                      # all six tasks
 *   tsx --env-file=../../.env scripts/smoke.ts read_moment write_line
 *   tsx --env-file=../../.env scripts/smoke.ts read_moment --read=voicemail
 *
 * `--read=<case>` picks the read_moment input from the labelled cases (gatekeeper by default).
 * Prints task, model, latency, request id and output. Never prints the key.
 */
import { TASK_IDS, type TaskId } from '@cue/core';
import { createMubit } from '../src/client';
import { loadMubitConfig } from '../src/config';
import { isMubitError } from '../src/errors';
import { INPUTS, LABELLED_READS } from '../test/fixtures';

const args = process.argv.slice(2);
const readCase = args.find((a) => a.startsWith('--read='))?.slice('--read='.length);
const wanted = args.filter((a) => !a.startsWith('--'));
const unknown = wanted.filter((t) => !(TASK_IDS as readonly string[]).includes(t));
if (unknown.length) {
  console.error(`unknown task(s): ${unknown.join(', ')}. Tasks: ${TASK_IDS.join(', ')}`);
  process.exit(2);
}
const tasks = (wanted.length ? wanted : TASK_IDS) as TaskId[];

const config = loadMubitConfig();
if (!config.configured) {
  console.error('MUBIT_API_KEY is not set (run with --env-file=../../.env)');
  process.exit(2);
}

const inputs = { ...INPUTS };
if (readCase) {
  const c = LABELLED_READS.find((r) => r.name.replace(/\W+/g, '_').toLowerCase().includes(readCase.toLowerCase()));
  if (!c) {
    console.error(`no read_moment case matches "${readCase}". Cases: ${LABELLED_READS.map((r) => r.name).join(', ')}`);
    process.exit(2);
  }
  inputs.read_moment = c.input;
}

const client = createMubit({ ...config, timeoutMs: 45_000 });
const sessionId = `call_smoke_${Date.now().toString(36)}`;
console.log(`session ${sessionId} · ${config.baseUrl} · fast ${config.models.fast} · write ${config.models.write}\n`);

let failed = 0;
for (const task of tasks) {
  try {
    const r = await client.run(task, inputs[task] as never, { sessionId });
    console.log(`■ ${task}  ${r.model}  ${r.latencyMs} ms  ${r.requestId ?? '(no request id)'}  attempts ${r.attempts}  $${r.costUsd.toFixed(5)}`);
    console.log(JSON.stringify(r.output, null, 2), '\n');
  } catch (e) {
    failed += 1;
    if (isMubitError(e)) console.log(`✗ ${task}  ${e.code}  status ${e.status ?? '-'}  ${e.requestId ?? ''}  ${e.message}\n`);
    else console.log(`✗ ${task}  ${String(e)}\n`);
  }
}
process.exit(failed ? 1 : 0);
