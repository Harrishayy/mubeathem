import { computeFeatures, demoScript, DEMO_PROSPECT, type Moment, type Persona, type Receptivity, type TaskInput, type Turn } from '@cue/core';

/**
 * Labelled read_moment eval: every prospect line of the context.md §11 demo (both variants) read
 * with its real preceding window, plus edge lines that tripped the model in end-to-end runs.
 * `accept` lists every moment a good playbook card could answer; the first is the preferred one.
 */
export interface EvalCase {
  name: string;
  accept: Moment[];
  persona?: Persona;
  receptivity?: Receptivity[];
  /** When set, should_suggest must equal it. */
  shouldSuggest?: boolean;
  input: TaskInput<'read_moment'>;
}

const CRM = { title: DEMO_PROSPECT.title, company: DEMO_PROSPECT.company, facts: DEMO_PROSPECT.facts };
type Line = { speaker: 'rep' | 'prospect'; text: string };
type Prev = TaskInput<'read_moment'>['previous'];

/** A window and features exactly as the server builds them: last 8 turns, features from core. */
function inputFor(lines: Line[], previous: Prev, crm = CRM): TaskInput<'read_moment'> {
  const turns: Turn[] = lines.map((l, i) => ({ id: `turn_${i + 1}`, speaker: l.speaker, text: l.text, tMs: 2000 + i * 3500, durMs: 2500, final: true, via: 'typed' }));
  const window = turns.slice(-8).map((t) => ({ speaker: t.speaker, text: t.text, tMs: t.tMs }));
  return { crm, window, features: computeFeatures(turns, turns.length - 1), previous };
}

/** Labels for the demo's prospect lines (core labels some; the rest are labelled here). */
function demoLabel(text: string, expect: Moment | undefined): { accept: Moment[]; persona: Persona; shouldSuggest?: boolean } {
  if (/Go on\.$/.test(text)) return { accept: ['opener', 'whats_this_regarding'], persona: 'ceo' };
  if (expect === 'gatekeeper') return { accept: ['gatekeeper'], persona: 'gatekeeper' };
  if (expect === 'close') return { accept: ['close'], persona: 'ceo', shouldSuggest: true };
  if (!expect) throw new Error(`unlabelled demo line: ${text}`);
  return { accept: [expect], persona: 'ceo' };
}

function demoCases(variant: 'warm' | 'cold'): EvalCase[] {
  const script = demoScript(variant);
  const out: EvalCase[] = [];
  let previous: Prev = null;
  script.forEach((line, i) => {
    if (line.speaker !== 'prospect') return;
    const label = demoLabel(line.text, line.expect);
    const receptivity = line.receptivity;
    out.push({
      name: `demo/${variant}: ${line.text.slice(0, 40)}`,
      accept: label.accept,
      persona: label.persona,
      ...(receptivity ? { receptivity } : {}),
      ...(label.shouldSuggest !== undefined ? { shouldSuggest: label.shouldSuggest } : {}),
      input: inputFor(script.slice(0, i + 1), previous),
    });
    previous = { persona: label.persona, receptivity: receptivity?.[0] ?? 'neutral', moment: label.accept[0]! };
  });
  return out;
}

const INTRO: Line[] = [
  { speaker: 'prospect', text: 'Hi, this is Maya.' },
  { speaker: 'rep', text: "Maya, it's Alex at Corgi. Saw the Series A, congrats. Have you got thirty seconds?" },
];
const AFTER_WTR: Line[] = [
  ...INTRO,
  { speaker: 'prospect', text: "What's this regarding?" },
  { speaker: 'rep', text: "It's about D&O. After a raise most boards want it sorted, and I wanted to check yours is." },
];
const AFTER_PITCH: Line[] = [
  ...AFTER_WTR,
  { speaker: 'prospect', text: 'Okay.' },
  { speaker: 'rep', text: 'Most founders we talk to after a Series A find their D&O is still the seed policy. Who looks after that for you?' },
];
const opener: Prev = { persona: 'ceo', receptivity: 'neutral', moment: 'opener' };
const wtr: Prev = { persona: 'ceo', receptivity: 'neutral', moment: 'whats_this_regarding' };

function edge(name: string, accept: Moment[], context: Line[], text: string, previous: Prev, extra: Partial<EvalCase> = {}): EvalCase {
  return { name: `edge: ${name}`, accept, ...extra, input: inputFor([...context, { speaker: 'prospect', text }], previous) };
}

export const EDGE_CASES: EvalCase[] = [
  edge('who gave you this number', ['whats_this_regarding', 'objection_not_interested'], INTRO, 'Who gave you this number?', opener, { receptivity: ['cold'] }),
  edge('call back next week', ['brush_off_busy', 'objection_timing'], INTRO, "Now's not great. Can you call back next week?", opener),
  edge('is this a sales call', ['whats_this_regarding'], INTRO, 'Is this a sales call?', opener),
  edge('happy with current setup', ['objection_broker', 'objection_not_interested'], AFTER_PITCH, "We're happy with our current setup, thanks.", wtr),
  edge('what does it cost roughly', ['buying_signal'], AFTER_PITCH, 'Hm. What does it cost, roughly?', wtr),
  edge('sure send me something', ['brush_off_email'], AFTER_WTR, 'Sure, send me something.', wtr),
  edge('second voice CFO', ['whats_this_regarding'], AFTER_WTR, "Hi, I'm the CFO, Maya just looped me in. What's this about?", wtr, { persona: 'cfo' }),
  edge('not interested', ['objection_not_interested'], AFTER_WTR, 'Not interested, thanks.', wtr),
  edge('how does a quote work', ['buying_signal'], AFTER_PITCH, 'How does getting a quote actually work with you guys?', wtr),
  edge('receptionist who is calling', ['gatekeeper'], [{ speaker: 'rep', text: 'Hi, is Maya there?' }], "Sorry, who's calling?", null, { persona: 'gatekeeper' }),
  edge('small talk', ['small_talk'], INTRO, "Ha, thanks. It's been a mad week. How's yours going?", opener, { shouldSuggest: false }),
  edge("okay I'm listening", ['opener', 'whats_this_regarding'], AFTER_WTR, "Okay, I'm listening.", wtr),
  edge('no budget', ['objection_price', 'objection_timing'], AFTER_PITCH, "We don't really have budget for more insurance right now.", wtr),
  edge('what is the next step', ['close', 'buying_signal'], AFTER_PITCH, 'Sounds interesting. What would the next step be?', wtr),
];

const warmOnly = demoCases('warm').filter((c) => !demoCases('cold').some((d) => d.input.window.at(-1)!.text === c.input.window.at(-1)!.text));

export const EVAL_CASES: EvalCase[] = [...demoCases('cold'), ...warmOnly, ...EDGE_CASES];
