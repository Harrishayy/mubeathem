import { MOMENTS, PERSONAS, TASK_IDS, TASK_INPUT, TASK_OUTPUT, TONE_SIGNALS } from '@cue/core';
import { describe, expect, it } from 'vitest';
import { TASKS } from '../src/tasks';
import { INPUTS, LABELLED_READS, OUTPUTS } from './fixtures';

describe('task definitions', () => {
  it('defines every task id with its own output schema', () => {
    expect(Object.keys(TASKS).sort()).toEqual([...TASK_IDS].sort());
    for (const id of TASK_IDS) {
      expect(TASKS[id].id).toBe(id);
      expect(TASKS[id].output).toBe(TASK_OUTPUT[id]);
      expect(TASKS[id].version).toBeGreaterThanOrEqual(1);
    }
  });

  it('puts fast tasks on the fast model and writing tasks on the write model (architecture §4.1)', () => {
    expect(TASK_IDS.filter((t) => TASKS[t].tier === 'fast').sort()).toEqual(['check_claim', 'read_moment', 'simulate_prospect']);
  });

  it.each(TASK_IDS)('%s instructions are a fixed constant with no prospect data', (id) => {
    const text = TASKS[id].instructions;
    expect(text.length).toBeGreaterThan(800);
    expect(text).not.toMatch(/\$\{|undefined|\[object Object\]/);
    // The demo prospect must never leak into instructions (it would split the Mubit task).
    expect(text).not.toMatch(/Maya|Lumen/);
    expect(text.trim().endsWith('Reply with the JSON object only.')).toBe(true);
  });

  it('read_moment instructions define every persona, moment and signal', () => {
    const text = TASKS.read_moment.instructions;
    for (const v of [...PERSONAS, ...MOMENTS, ...TONE_SIGNALS]) expect(text).toContain(`- ${v}: `);
  });

  it('review_call instructions carry the used threshold and every win rule', () => {
    const text = TASKS.review_call.instructions;
    expect(text).toContain('0.6 or more');
    for (const m of MOMENTS) expect(text).toContain(`- ${m}: job `);
  });

  it('every example embedded in the instructions is a valid input and output', () => {
    for (const id of TASK_IDS) {
      const text = TASKS[id].instructions;
      const outputs = [...text.matchAll(/^Output: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]!));
      expect(outputs.length, id).toBeGreaterThanOrEqual(1);
      for (const o of outputs) expect(TASK_OUTPUT[id].safeParse(o).success, `${id} example output`).toBe(true);
      if (id === 'review_call') continue; // its example record is abridged on purpose
      for (const m of text.matchAll(/^Input: (\{.*\})$/gm)) {
        const r = TASK_INPUT[id].safeParse(JSON.parse(m[1]!));
        expect(r.success, `${id} example input: ${r.success ? '' : r.error.message}`).toBe(true);
      }
    }
  });

  it('fixtures are valid for every task', () => {
    for (const id of TASK_IDS) {
      expect(TASK_INPUT[id].safeParse(INPUTS[id]).success, id).toBe(true);
      expect(TASK_OUTPUT[id].safeParse(OUTPUTS[id]).success, id).toBe(true);
    }
    for (const c of LABELLED_READS) expect(TASK_INPUT.read_moment.safeParse(c.input).success, c.name).toBe(true);
  });
});

describe('normalisers', () => {
  it('read_moment clamps numbers, keeps the score in the label band and stays quiet on voicemail', () => {
    const out = TASKS.read_moment.normalize!({ ...OUTPUTS.read_moment, moment: 'voicemail', receptivity: 'cold', receptivity_score: 0.4, persona_confidence: 1.4, signals: ['asked_question', 'asked_question'], should_suggest: true });
    expect(out.receptivity_score).toBe(-0.65);
    expect(out.persona_confidence).toBe(1);
    expect(out.signals).toEqual(['asked_question']);
    expect(out.should_suggest).toBe(false);
  });

  it('read_moment turns a screener asking "what is it about" into gatekeeper and always shows a card at close', () => {
    const gk = TASKS.read_moment.normalize!({ ...OUTPUTS.read_moment, persona: 'gatekeeper', moment: 'whats_this_regarding' });
    expect(gk.moment).toBe('gatekeeper');
    const close = TASKS.read_moment.normalize!({ ...OUTPUTS.read_moment, persona: 'ceo', moment: 'close', should_suggest: false });
    expect(close.should_suggest).toBe(true);
    const opener = TASKS.read_moment.normalize!({ ...OUTPUTS.read_moment, persona: 'ceo', moment: 'opener', should_suggest: false });
    expect(opener.should_suggest).toBe(false);
  });

  it('review_call holds "used" to similarity >= 0.6 and never credits an unused step', () => {
    const out = TASKS.review_call.normalize!({
      ...OUTPUTS.review_call,
      lines_used: [
        { suggestion_id: 'a', used: true, said_text: 'x', similarity: 0.4, step_win: true },
        { suggestion_id: 'b', used: false, said_text: 'y', similarity: 0.8, step_win: true },
      ],
    });
    expect(out.lines_used.map((l) => [l.used, l.step_win])).toEqual([[false, false], [true, true]]);
  });
});

describe('read_moment eval cases', async () => {
  const { EVAL_CASES } = await import('./eval-cases');
  it('cover the demo script and the edge lines with valid inputs', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(24);
    for (const c of EVAL_CASES) expect(TASK_INPUT.read_moment.safeParse(c.input).success, c.name).toBe(true);
    expect(EVAL_CASES.find((c) => c.input.window.at(-1)!.text === 'Thursday works. Send me the invite.')?.shouldSuggest).toBe(true);
  });
});
