import { OUTCOMES, type Outcome } from '@cue/core';
import type { Bootstrap } from './requests';

/** Raw disposition label → Outcome. Keys are matched case-, space- and punctuation-insensitively. */
export type DispositionMap = Readonly<Record<string, Outcome>>;

export const DEFAULT_DISPOSITION_MAP: DispositionMap = {
  'Demo booked': 'meeting_booked',
  'Meeting booked': 'meeting_booked',
  'Meeting set': 'meeting_booked',
  'Meeting scheduled': 'meeting_booked',
  'Appointment set': 'meeting_booked',
  Booked: 'meeting_booked',
  Interested: 'follow_up',
  'Follow up': 'follow_up',
  'Send info': 'follow_up',
  'Not interested': 'not_interested',
  'Do not call': 'not_interested',
  DNC: 'not_interested',
  Gatekeeper: 'gatekeeper_blocked',
  Voicemail: 'voicemail',
  'Left voicemail': 'voicemail',
  'No answer': 'no_answer',
  Busy: 'no_answer',
  'Wrong number': 'wrong_person',
  'Wrong person': 'wrong_person',
  'Bad number': 'wrong_person',
  'Call back': 'callback_requested',
  'Call back later': 'callback_requested',
};

/** "Follow-Up", "follow up" and "FOLLOWUP" all become "followup". */
export function dispositionKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const indexCache = new WeakMap<object, Map<string, Outcome>>();

function indexOf(map: DispositionMap): Map<string, Outcome> {
  let idx = indexCache.get(map);
  if (!idx) {
    idx = new Map();
    for (const [label, outcome] of Object.entries(map)) idx.set(dispositionKey(label), outcome);
    indexCache.set(map, idx);
  }
  return idx;
}

/** Unknown, empty or unmapped labels → `unknown`. The raw string is kept by the caller. */
export function mapDisposition(raw: string | null | undefined, map: DispositionMap = DEFAULT_DISPOSITION_MAP): Outcome {
  if (!raw) return 'unknown';
  return indexOf(map).get(dispositionKey(raw)) ?? 'unknown';
}

/**
 * Keyword rules used only to learn an account's own labels from /bootstrap ("Meeting Scheduled - AE",
 * "Not Interested - Has Broker"). Order matters: "not interested" before "interested".
 */
const KEYWORD_RULES: Array<[RegExp, Outcome]> = [
  [/\bwrong\b|\bbad (number|phone)\b|\bdisconnected\b|\bno longer\b/, 'wrong_person'],
  [/\bnot interested\b|\bdo not call\b|\bdnc\b|\bunsubscribe\b|\bremove\b/, 'not_interested'],
  [/\bgate ?keeper\b|\bscreened\b|\breceptionist\b/, 'gatekeeper_blocked'],
  [/\bvoice ?mail\b|\bvm\b/, 'voicemail'],
  [/\bno answer\b|\bno pick ?up\b|\bbusy\b|\bunanswered\b/, 'no_answer'],
  [/\bcall ?back\b|\bcallback\b|\bcall later\b/, 'callback_requested'],
  [/\bmeeting\b|\bdemo\b|\bbooked\b|\bappointment\b|\bscheduled\b|\bset\b/, 'meeting_booked'],
  [/\binterested\b|\bfollow ?up\b|\bsend (info|email)\b|\bemail\b|\bnurture\b/, 'follow_up'],
];

export function guessOutcome(label: string): Outcome {
  const t = ` ${label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const [re, outcome] of KEYWORD_RULES) if (re.test(t)) return outcome;
  return 'unknown';
}

export interface LearnedDisposition {
  /** The account's exact string, as /bootstrap returns it. */
  raw: string;
  outcome: Outcome;
  via: 'default' | 'keyword' | 'override' | 'unmapped';
}

export interface AccountVocabulary {
  dispositions: string[];
  sentiments: string[];
  purposes: string[];
}

/**
 * /bootstrap's shape is not documented beyond "exact disposition, sentiment and purpose strings".
 * Search it for arrays under keys mentioning disposition / sentiment / purpose, taking strings or
 * objects with a label-like field. Depth-limited and de-duplicated.
 */
export function extractVocabulary(bootstrap: Bootstrap | null | undefined): AccountVocabulary {
  const out = { dispositions: new Set<string>(), sentiments: new Set<string>(), purposes: new Set<string>() };
  const bucketFor = (key: string): Set<string> | null => {
    const k = key.toLowerCase();
    if (k.includes('disposition')) return out.dispositions;
    if (k.includes('sentiment')) return out.sentiments;
    if (k.includes('purpose')) return out.purposes;
    return null;
  };
  const walk = (node: unknown, depth: number, target: Set<string> | null): void => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (target && node.trim() && node.length <= 120) target.add(node.trim());
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, target);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (target) {
      const label = pickLabel(obj);
      if (label) {
        target.add(label);
        return;
      }
    }
    for (const [key, value] of Object.entries(obj)) walk(value, depth + 1, bucketFor(key) ?? (typeof value === 'object' ? target : null));
  };
  walk(bootstrap, 0, null);
  return { dispositions: [...out.dispositions], sentiments: [...out.sentiments], purposes: [...out.purposes] };
}

const LABEL_KEYS = ['label', 'name', 'option', 'value', 'text', 'title', 'disposition'];
function pickLabel(obj: Record<string, unknown>): string | null {
  for (const k of LABEL_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Each of the account's dispositions with the outcome Cue will record and why. For the settings screen. */
export function learnDispositions(bootstrap: Bootstrap | null | undefined, overrides: Record<string, Outcome> = {}): LearnedDisposition[] {
  const overrideIdx = new Map(Object.entries(overrides).map(([k, v]) => [dispositionKey(k), v] as const));
  return extractVocabulary(bootstrap).dispositions.map((raw) => {
    const key = dispositionKey(raw);
    const override = overrideIdx.get(key);
    if (override && (OUTCOMES as readonly string[]).includes(override)) return { raw, outcome: override, via: 'override' };
    const exact = indexOf(DEFAULT_DISPOSITION_MAP).get(key);
    if (exact) return { raw, outcome: exact, via: 'default' };
    const guess = guessOutcome(raw);
    return { raw, outcome: guess, via: guess === 'unknown' ? 'unmapped' : 'keyword' };
  });
}

/** Defaults + the account's own labels (from /bootstrap) + manual overrides, most specific last. */
export function buildDispositionMap(bootstrap: Bootstrap | null | undefined, overrides: Record<string, Outcome> = {}): DispositionMap {
  const map: Record<string, Outcome> = { ...DEFAULT_DISPOSITION_MAP };
  for (const d of learnDispositions(bootstrap, overrides)) if (d.outcome !== 'unknown') map[d.raw] = d.outcome;
  for (const [raw, outcome] of Object.entries(overrides)) map[raw] = outcome;
  return dedupeByKey(map);
}

/** Later entries win when two labels normalise to the same key. */
function dedupeByKey(map: Record<string, Outcome>): DispositionMap {
  const byKey = new Map<string, [string, Outcome]>();
  for (const [raw, outcome] of Object.entries(map)) byKey.set(dispositionKey(raw), [raw, outcome]);
  return Object.freeze(Object.fromEntries([...byKey.values()]));
}
