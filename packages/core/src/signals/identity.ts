import type { Prospect, Situation } from '../schema';
import { personaFromTitle } from './rules';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when the turn is the CRM contact introducing themselves ("Hi, this is Maya", "Maya speaking",
 * "Maya here", "it's Maya Chen"). Needs the contact's first name; case- and punctuation-insensitive.
 */
export function selfIdentifies(text: string, prospect: Pick<Prospect, 'name'>): boolean {
  const first = prospect.name.trim().split(/\s+/)[0];
  if (!first || first.length < 2) return false;
  const name = escape(first.toLowerCase());
  const t = text.toLowerCase().replace(/[’']/g, "'");
  return new RegExp(`\\b(this is|it's|it is|i'm|i am|you've got|you have)\\s+${name}\\b|\\b${name}\\s+(speaking|here)\\b`).test(t);
}

/**
 * Correct a read when the decision-maker picks up after a gatekeeper. Models anchor on the previous
 * persona, so "Hi, this is Maya" after "let me put you through" still reads as gatekeeper. When the
 * contact names themselves, the persona comes from their CRM title and the gatekeeper moment becomes
 * the opener.
 */
export function applyIdentity(situation: Situation, text: string, prospect: Pick<Prospect, 'name' | 'title'>): Situation {
  if (!selfIdentifies(text, prospect)) return situation;
  const persona = personaFromTitle(prospect.title);
  if (persona === 'gatekeeper' || persona === 'unknown') return situation;
  const moment = situation.moment === 'gatekeeper' ? 'opener' : situation.moment;
  if (persona === situation.persona && moment === situation.moment) return situation;
  return {
    ...situation,
    persona,
    personaConfidence: Math.max(situation.personaConfidence, 0.9),
    moment,
    shouldSuggest: moment === 'opener' ? true : situation.shouldSuggest,
    rationale: `${situation.rationale} (contact named themselves)`.slice(0, 300),
  };
}
