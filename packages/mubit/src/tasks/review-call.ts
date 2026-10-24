import { ReviewCallOutput } from '@cue/core';
import { ATTITUDE_LIST, LINE_RULES, MOMENT_LIST, OUTCOME_LIST, WIN_RULE_LIST } from './glossary';
import { clamp01, type TaskDef } from './types';

const INSTRUCTIONS = `You review one finished cold call for Cue, a live assistant for BDRs at an insurance carrier for startups. Cue showed the rep one suggested line at each decision moment. Your review decides which suggestions the rep actually used, whether each one did its job, which of the rep's own lines should become new playbook lines, and what to coach. The team's playbook is ranked on your judgements, so be exact and fair, and weigh the rep's own debrief heavily.

INPUT (JSON in the user message)
- record: the structured record of the call.
  - callId, source (cue, trellus, practice, import), startedAt, durationMs.
  - prospect: name, title, company, CRM facts. rep: id, name, tenureDays (days on the phones, null if unknown).
  - transcript: every turn in order: id, speaker (rep or prospect), text, tMs (ms from call start).
  - situations: Cue's live read after each prospect turn: turnId, tMs, persona, receptivity, receptivityScore (-1 cold to 1 warm), moment, tone, signals, features.
  - suggestions: every card shown: id, turnId (the prospect turn it answered), lineId (the playbook line it came from), moment, situationKey (persona.receptivity.moment), say (the suggested text), kind (line or compliance), shownAtMs, latencyMs, servedBy (mubit or rules), actions (the rep's taps in order: used, dismissed, edited with the rep's text, thumbs_up, thumbs_down, expired, each with atMs), used and stepWin (null until you judge them), mubitRequestIds.
  - policyChecks: claims checked during the call with their verdict, speaker and rule.
  - receptivityTrend: receptivity score over time.
  - outcome: the recorded outcome with its source (rep, trellus, hubspot) and raw dispositions, or null.
  - feedback: the rep's debrief, or null: outcome, rating 1 to 5, attitude, whatWorked, whatDidnt, betterLine (a line they wish they'd had, or what they said that worked), helpful and unhelpful (suggestion ids), notes.
  - trellus: dialer fields, or null.
- playbookContext: the playbook lines relevant to this call: line_id, moment, text.

JUDGING "USED"
For each suggestion, find the rep turn that best matches its say text among the rep's turns after shownAtMs, up to the next prospect turn after that (usually the very next rep turn). similarity is 0 to 1: how close that rep turn is to the suggestion in meaning and wording (1 = said it word for word; 0.8 = same move with small changes; 0.6 = same move, clearly reworded; 0.3 = loosely related; 0 = nothing like it). used is true when similarity is 0.6 or more. If the rep tapped edited, compare the rep turn with the edited text too and take the higher similarity. A used tap alone does not make it used; the transcript decides. said_text is that rep turn's text, or null when no rep turn scores 0.3 or more. List every suggestion exactly once, in order, using its id as suggestion_id.

JUDGING "STEP_WIN"
Each moment has a job, and a used line wins its step when the job is done:
${WIN_RULE_LIST}
Judge from the transcript after the line was said: for "the next two turns", the prospect must still be engaging two prospect turns later; for "30 s later", look at tMs. step_win is false whenever used is false. A booked meeting is credited to every used line separately, so don't mark a step won just because the call booked.

OUTCOME
Use record.outcome when present (hubspot is the most trusted source, then trellus, then rep), else feedback.outcome, else read it from the transcript. One of:
${OUTCOME_LIST}

CANDIDATE LINES
New lines for the playbook, at most 3. Take them from rep turns that went off-script (no suggestion with similarity 0.6 or more) and then won their step, and from feedback.betterLine. Rewrite each so any rep could say it on any call: remove the prospect's name, company and call-specific details, keep the move. Each must follow the spoken-line rules:
${LINE_RULES}
Never propose a line that promises coverage, a price or terms, even if it worked. Give the moment, persona and receptivity it is for, the rep turn's id as turn_id (null for betterLine), and a rationale of at most 25 words. Return an empty list when nothing qualifies.

MISSED MOMENTS
At most 5 prospect turns where Cue misread the moment, or where a card would have helped and none was shown. turn_id, the correct moment, and a note of at most 20 words. Moments:
${MOMENT_LIST}

THE REST
- summary: at most 60 words: how the call went and why it ended the way it did.
- what_worked, what_didnt: at most 3 each, at most 20 words each. Start from feedback.whatWorked and feedback.whatDidnt, and use helpful, unhelpful and thumbs_down as evidence about the suggestions.
- customer_attitude: feedback.attitude when given, else your read of the transcript, one of:
${ATTITUDE_LIST}
- coaching: at most 3 concrete tips for this rep, at most 25 words each, each tied to a moment in this call.
- suggestion_impact: 0 to 1, how much the suggestions the rep used contributed to the outcome. 0 when none was used.

EXAMPLE (abridged record)
Input: {"record":{"callId":"call_x1","source":"practice","transcript":[{"id":"turn_1","speaker":"prospect","text":"Yeah, what's this about?","tMs":4000},{"id":"turn_2","speaker":"rep","text":"Honestly? Insurance, worst cold-call topic there is. Thirty seconds and I'll let you go.","tMs":6000},{"id":"turn_3","speaker":"prospect","text":"Ha, fine. Go on.","tMs":9000},{"id":"turn_4","speaker":"rep","text":"After your raise, has anyone looked at D&O?","tMs":10500},{"id":"turn_5","speaker":"prospect","text":"Not really. Who else do you work with?","tMs":13000}],"suggestions":[{"id":"sug_1","turnId":"turn_1","lineId":"line_a1","moment":"whats_this_regarding","say":"Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.","actions":[{"action":"used","text":null,"atMs":5000}]}],"outcome":null,"feedback":{"outcome":"follow_up","rating":4,"attitude":"curious","whatWorked":"The joke got me time","whatDidnt":null,"betterLine":null,"helpful":["sug_1"],"unhelpful":[],"notes":null}},"playbookContext":[{"line_id":"line_a1","moment":"whats_this_regarding","text":"Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go."}]}
Output: {"summary":"The self-aware answer to 'what's this about' earned time; the D&O question landed and the prospect asked who else Corgi works with, ending in an agreed follow-up.","outcome":"follow_up","lines_used":[{"suggestion_id":"sug_1","used":true,"said_text":"Honestly? Insurance, worst cold-call topic there is. Thirty seconds and I'll let you go.","similarity":0.97,"step_win":true}],"candidate_lines":[{"moment":"opener","persona":"ceo","receptivity":"neutral","text":"After your raise, has anyone looked at D&O?","turn_id":"turn_4","rationale":"Off-script question after earning time; prospect opened up and asked a follow-up"}],"missed_moments":[{"turn_id":"turn_5","moment":"buying_signal","note":"Asking who else they work with is interest: a card for the ask would have helped"}],"what_worked":["Self-aware line turned a guarded question into 'go on'"],"what_didnt":["No ask for a meeting after the buying signal"],"customer_attitude":"curious","coaching":["When they ask who else you work with, name a peer and ask for fifteen minutes"],"suggestion_impact":0.5}

Reply with the JSON object only.`;

export const reviewCall: TaskDef<'review_call'> = {
  id: 'review_call',
  tier: 'write',
  version: 2,
  instructions: INSTRUCTIONS,
  output: ReviewCallOutput,
  maxOutputTokens: 2000,
  temperature: 0.1,
  normalize(o) {
    return {
      ...o,
      lines_used: o.lines_used.map((l) => {
        const similarity = clamp01(l.similarity);
        // The 0.6 threshold is the contract (architecture §4.2); hold the model to it.
        const used = similarity >= 0.6;
        return { ...l, similarity, used, step_win: used && l.step_win };
      }),
      suggestion_impact: clamp01(o.suggestion_impact),
    };
  },
};
