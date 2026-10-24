import type { Moment, Outcome } from '../taxonomy';
import { MOMENT_META } from '../taxonomy';
import type { Turn } from '../schema/domain';
import { findRiskyClaims } from '../policy/rules';
import { isQuestion, normaliseText } from '../text';

/** How long the prospect has to keep talking after an opener for it to count. */
export const EARN_TIME_MS = 30_000;

const GOT_THROUGH =
  /\b(put you through|putting you through|transfer(ring)? you|connect(ing)? you|let me (get|grab|see if|check)|hold on|one (sec|second|moment)|(she|he)('s| is| will be) (usually )?(free|in|around|available|back)|best time|try (her|him|again) (at|on|after|around|tomorrow)|(her|his) name is|(she|he) handles|you('ll| will|'d| would) want to (talk|speak) (to|with)|speak (to|with) (her|him)|this is \w+)\b/;
const ENDING = /\b(not interested|take me off|stop calling|don'?t call|i have to go|got to go|gotta go|goodbye|bye|hanging up|no thanks|no thank you)\b/;

/**
 * Whether a line won its step (context.md §6.2), judged on the turns after it was shown.
 * A booked meeting credits every line. Close and buying-signal lines only win on a booking.
 */
export function stepWin(moment: Moment, turnsAfter: Turn[], outcome?: Outcome): boolean {
  if (outcome === 'meeting_booked') return true;
  const after = turnsAfter.filter((t) => t.final !== false);
  const prospect = after.filter((t) => t.speaker === 'prospect');

  if (moment === 'whats_this_regarding') {
    // Earned time if, within the next two prospect turns, they ask a follow-up rather than end it.
    for (const t of prospect.slice(0, 2)) {
      const text = normaliseText(t.text);
      if (ENDING.test(text)) return false;
      if (isQuestion(t.text)) return true;
    }
    return false;
  }

  switch (MOMENT_META[moment].job) {
    case 'get_through':
      return outcome === 'gatekeeper_blocked' ? false : prospect.slice(0, 3).some((t) => GOT_THROUGH.test(normaliseText(t.text)));
    case 'earn_time': {
      const from = after[0]?.tMs;
      if (from === undefined) return false;
      return prospect.some((t) => t.tMs + (t.durMs ?? 0) >= from + EARN_TIME_MS);
    }
    case 'keep_alive': {
      if (after.length <= 2) return false;
      return !after.slice(0, 2).some((t) => t.speaker === 'prospect' && ENDING.test(normaliseText(t.text)));
    }
    case 'protect':
      return !after.some((t) => t.speaker === 'rep' && findRiskyClaims(t.text).length > 0);
    case 'book':
    case 'none':
      return false;
  }
}
