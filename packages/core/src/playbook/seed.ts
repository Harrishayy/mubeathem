import type { Moment, Persona, ProductLine, Receptivity } from '../taxonomy';
import type { LineStats, PlaybookLine, UpNext } from '../schema/domain';

/** When the seed playbook was written. Fixed so the seed is identical on every machine. */
export const SEED_CREATED_AT = Date.UTC(2026, 8, 1);

type Row = [shown: number, used: number, stepWins: number, booked: number, lost: number];

function row([shown, used, stepWins, booked, lost]: Row): LineStats {
  return { shown, used, stepWins, booked, lost };
}

/** Per-situation rows plus their sum under `*`. */
function stats(rows: Record<string, Row>): Record<string, LineStats> {
  const out: Record<string, LineStats> = {};
  const total: LineStats = { shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 };
  for (const [key, r] of Object.entries(rows)) {
    const st = row(r);
    out[key] = st;
    total.shown += st.shown;
    total.used += st.used;
    total.stepWins += st.stepWins;
    total.booked += st.booked;
    total.lost += st.lost;
  }
  out['*'] = total;
  return out;
}

interface SeedSpec {
  slug: string;
  moment: Moment;
  style: 'straight' | 'self-aware' | 'question' | 'proof';
  text: string;
  personas?: Persona[];
  receptivity?: Receptivity[];
  products?: ProductLine[];
  stats: Record<string, Row>;
}

function line(s: SeedSpec): PlaybookLine {
  return {
    id: `line_seed_${s.slug}`,
    moment: s.moment,
    personas: s.personas ?? [],
    receptivity: s.receptivity ?? [],
    text: s.text,
    style: s.style,
    products: s.products ?? [],
    status: 'active',
    origin: 'seed',
    createdAt: SEED_CREATED_AT,
    stats: stats(s.stats),
    policy: { verdict: 'supported' },
  };
}

/*
 * Copy rules: Corgi's BDR voice, confident and plain, one breath each. No names (lines are team-wide
 * and the writer tailors them), no premium figures, no coverage promises. Stats are seeded so the demo
 * has evidence on day one; lines with fewer than 10 shows are young and get the exploration slot.
 */
const SPECS: SeedSpec[] = [
  /* ── gatekeeper: get through ── */
  {
    slug: 'gk_board',
    moment: 'gatekeeper',
    style: 'straight',
    products: ['d_and_o'],
    text: "Totally fair. It's about the board's D&O cover after the raise. Is that usually the CEO, or does your CFO handle it?",
    stats: { 'gatekeeper.neutral.gatekeeper': [41, 38, 14, 4, 9], 'gatekeeper.warm.gatekeeper': [22, 20, 10, 3, 3], 'gatekeeper.cool.gatekeeper': [12, 10, 3, 1, 3] },
  },
  {
    slug: 'gk_name',
    moment: 'gatekeeper',
    style: 'question',
    text: "No problem at all. Who's the best person for insurance there, and when are they usually free?",
    stats: { 'gatekeeper.neutral.gatekeeper': [30, 27, 6, 2, 8], 'gatekeeper.warm.gatekeeper': [10, 9, 4, 1, 2] },
  },
  {
    slug: 'gk_help',
    moment: 'gatekeeper',
    style: 'straight',
    text: "I'm hoping you can point me the right way. Who looks after your company insurance?",
    stats: { 'gatekeeper.neutral.gatekeeper': [25, 22, 4, 1, 9] },
  },
  {
    slug: 'gk_self',
    moment: 'gatekeeper',
    style: 'self-aware',
    text: "Honestly, it's a cold call about insurance, so I'll keep it short. When's a good time to catch them?",
    stats: { 'gatekeeper.neutral.gatekeeper': [6, 5, 2, 0, 1] },
  },

  /* ── opener: earn time ── */
  {
    slug: 'op_raise',
    moment: 'opener',
    style: 'question',
    personas: ['ceo', 'cfo', 'other_exec', 'unknown'],
    products: ['d_and_o'],
    text: "Thanks for picking up, it's Corgi calling. Saw the raise, congrats. Quick one: has anyone talked to you about D&O since the board changed?",
    stats: { 'ceo.neutral.opener': [52, 47, 29, 9, 10], 'ceo.warm.opener': [18, 17, 12, 4, 2] },
  },
  {
    slug: 'op_permission',
    moment: 'opener',
    style: 'self-aware',
    text: "I'll be honest, this is a cold call. Can I have thirty seconds, and you tell me if it's worth another thirty?",
    stats: { 'ceo.neutral.opener': [33, 30, 15, 4, 8], 'ceo.cool.opener': [11, 10, 5, 1, 3] },
  },
  {
    slug: 'op_straight',
    moment: 'opener',
    style: 'straight',
    text: "I'm calling from Corgi. We insure startups like yours, and I wanted to see who handles your insurance now that you've grown.",
    stats: { 'ceo.neutral.opener': [40, 36, 14, 3, 11] },
  },
  {
    slug: 'op_proof',
    moment: 'opener',
    style: 'proof',
    products: ['d_and_o', 'ai_liability'],
    text: 'We insure a lot of AI startups at your stage, and most found gaps in their cover after the raise. Worth a quick look?',
    stats: { 'ceo.neutral.opener': [7, 6, 3, 1, 1] },
  },
  {
    slug: 'op_engineer',
    moment: 'opener',
    style: 'question',
    personas: ['engineer'],
    products: ['ai_liability', 'e_and_o'],
    text: 'Quick one for you: when a customer asks what happens if your model gets something wrong, who answers that today?',
    stats: { 'engineer.neutral.opener': [14, 13, 7, 2, 3] },
  },

  /* ── "what's this regarding?": earn time ── */
  {
    slug: 'wtr_joke',
    moment: 'whats_this_regarding',
    style: 'self-aware',
    text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.",
    stats: {
      'ceo.cold.whats_this_regarding': [47, 41, 22, 6, 9],
      'ceo.cool.whats_this_regarding': [24, 21, 11, 3, 5],
      'ceo.warm.whats_this_regarding': [12, 10, 3, 1, 3],
    },
  },
  {
    slug: 'wtr_straight',
    moment: 'whats_this_regarding',
    style: 'straight',
    products: ['d_and_o'],
    text: "It's about D&O. After a raise most boards want it sorted, and I wanted to check yours is.",
    stats: {
      'ceo.cold.whats_this_regarding': [40, 35, 9, 2, 14],
      'ceo.cool.whats_this_regarding': [28, 25, 8, 2, 8],
      'ceo.warm.whats_this_regarding': [38, 34, 21, 7, 6],
      'ceo.neutral.whats_this_regarding': [26, 23, 11, 3, 5],
    },
  },
  {
    slug: 'wtr_hook',
    moment: 'whats_this_regarding',
    style: 'question',
    products: ['d_and_o'],
    text: 'Your raise, actually. Has anyone looked at your insurance since the board changed?',
    stats: { 'ceo.warm.whats_this_regarding': [20, 18, 8, 3, 3], 'ceo.neutral.whats_this_regarding': [15, 13, 6, 2, 3], 'ceo.cold.whats_this_regarding': [9, 8, 1, 0, 4] },
  },
  {
    slug: 'wtr_proof',
    moment: 'whats_this_regarding',
    style: 'proof',
    text: 'We insure a lot of startups at your stage, and I wanted to check your cover kept up with the raise.',
    stats: { 'ceo.neutral.whats_this_regarding': [5, 4, 2, 0, 1] },
  },

  /* ── brush-off: "send me an email" ── */
  {
    slug: 'em_question',
    moment: 'brush_off_email',
    style: 'question',
    text: "Happy to. So it's actually useful, what's the one thing you'd want it to answer?",
    stats: { 'ceo.neutral.brush_off_email': [30, 27, 16, 5, 6], 'ceo.cool.brush_off_email': [14, 12, 6, 2, 3] },
  },
  {
    slug: 'em_time',
    moment: 'brush_off_email',
    style: 'straight',
    text: 'Will do. Most of these never get opened though, so could we grab fifteen minutes this week instead?',
    stats: { 'ceo.neutral.brush_off_email': [26, 23, 9, 3, 7] },
  },
  {
    slug: 'em_self',
    moment: 'brush_off_email',
    style: 'self-aware',
    text: "I can, though I'll be honest, it'll land in the pile. Two quick questions now and I'll make it worth reading?",
    stats: { 'ceo.cool.brush_off_email': [15, 13, 6, 1, 4] },
  },
  {
    slug: 'em_proof',
    moment: 'brush_off_email',
    style: 'proof',
    text: "Sure. I'll send what founders at your stage found when they checked their D&O. Anyone else I should copy in?",
    stats: { 'ceo.neutral.brush_off_email': [4, 3, 1, 0, 1] },
  },

  /* ── brush-off: "I'm busy" ── */
  {
    slug: 'busy_resched',
    moment: 'brush_off_busy',
    style: 'straight',
    text: "Totally get it. When's better, later today or first thing tomorrow?",
    stats: { 'ceo.cool.brush_off_busy': [28, 25, 14, 3, 6], 'ceo.neutral.brush_off_busy': [12, 11, 6, 2, 2] },
  },
  {
    slug: 'busy_thirty',
    moment: 'brush_off_busy',
    style: 'self-aware',
    text: "I'll be quick, promise. Thirty seconds, and if it's not relevant you can hang up on me.",
    stats: { 'ceo.cool.brush_off_busy': [22, 19, 9, 2, 6] },
  },
  {
    slug: 'busy_q',
    moment: 'brush_off_busy',
    style: 'question',
    text: "Understood. One question and I'm gone: has anyone reviewed your insurance since the raise?",
    stats: { 'ceo.cool.brush_off_busy': [6, 5, 2, 0, 2] },
  },

  /* ── objection: "we already have a broker" ── */
  {
    slug: 'br_requote',
    moment: 'objection_broker',
    style: 'question',
    text: 'Makes sense, most founders do. When did they last re-quote you after a raise?',
    stats: { 'ceo.neutral.objection_broker': [36, 34, 21, 8, 6], 'ceo.cool.objection_broker': [26, 24, 15, 5, 4], 'ceo.cold.objection_broker': [10, 9, 4, 1, 3] },
  },
  {
    slug: 'br_second',
    moment: 'objection_broker',
    style: 'straight',
    text: "Great, I'm not asking you to switch. A second quote just tells you whether you're getting a fair deal.",
    stats: { 'ceo.neutral.objection_broker': [27, 24, 11, 3, 7] },
  },
  {
    slug: 'br_ai',
    moment: 'objection_broker',
    style: 'proof',
    products: ['ai_liability'],
    text: "Most founders we talk to have one too. What's often missing is cover for the AI side of the product.",
    stats: { 'ceo.neutral.objection_broker': [16, 14, 6, 2, 4] },
  },
  {
    slug: 'br_self',
    moment: 'objection_broker',
    style: 'self-aware',
    text: "Of course, everyone does. I'm the second opinion nobody asked for. When does your policy renew?",
    stats: { 'ceo.cool.objection_broker': [5, 4, 2, 0, 1] },
  },

  /* ── objection: "not interested" ── */
  {
    slug: 'ni_fair',
    moment: 'objection_not_interested',
    style: 'question',
    text: "Fair enough. Is that because it's sorted, or because insurance is the last thing on your list?",
    stats: { 'ceo.cool.objection_not_interested': [24, 21, 9, 2, 8] },
  },
  {
    slug: 'ni_self',
    moment: 'objection_not_interested',
    style: 'self-aware',
    text: "Totally fair, nobody's ever interested in insurance. Can I ask one question before you go?",
    stats: { 'ceo.cold.objection_not_interested': [18, 16, 8, 1, 5] },
  },
  {
    slug: 'ni_straight',
    moment: 'objection_not_interested',
    style: 'straight',
    text: 'No problem. Before I go, has anyone looked at your D&O since the raise?',
    stats: { 'ceo.cool.objection_not_interested': [8, 7, 2, 0, 3] },
  },

  /* ── objection: price ── */
  {
    slug: 'pr_quote',
    moment: 'objection_price',
    style: 'straight',
    text: "Fair worry. The quote call is free, and you'll see a real number before you decide anything.",
    stats: { 'ceo.neutral.objection_price': [20, 18, 11, 4, 3] },
  },
  {
    slug: 'pr_q',
    moment: 'objection_price',
    style: 'question',
    text: 'Understood. Roughly what are you paying today, so we know if a second look is even worth it?',
    stats: { 'ceo.neutral.objection_price': [12, 10, 4, 1, 3] },
  },
  {
    slug: 'pr_proof',
    moment: 'objection_price',
    style: 'proof',
    text: "That's usually why founders call us. Fifteen minutes shows whether you're overpaying, no commitment.",
    stats: { 'ceo.neutral.objection_price': [6, 5, 3, 1, 1] },
  },

  /* ── objection: timing ── */
  {
    slug: 'tm_renewal',
    moment: 'objection_timing',
    style: 'question',
    text: "Makes sense. When does your current policy renew? I'll call a few weeks before.",
    stats: { 'ceo.neutral.objection_timing': [22, 20, 12, 3, 4] },
  },
  {
    slug: 'tm_ready',
    moment: 'objection_timing',
    style: 'straight',
    text: "Totally fair. A quick quote now just means you're ready when it matters, no switching required.",
    stats: { 'ceo.neutral.objection_timing': [15, 13, 5, 1, 4] },
  },
  {
    slug: 'tm_self',
    moment: 'objection_timing',
    style: 'self-aware',
    text: "Insurance is never the right time, I know. Fifteen minutes next week and it's off your list?",
    stats: { 'ceo.cool.objection_timing': [7, 6, 3, 0, 1] },
  },

  /* ── buying signal: go for the meeting ── */
  {
    slug: 'bs_meet',
    moment: 'buying_signal',
    style: 'straight',
    text: "Easiest is fifteen minutes with our team, they'll quote you live. Thursday or Friday?",
    stats: { 'ceo.warm.buying_signal': [30, 28, 17, 17, 5], 'ceo.neutral.buying_signal': [22, 20, 11, 11, 4] },
  },
  {
    slug: 'bs_depends',
    moment: 'buying_signal',
    style: 'question',
    text: 'Good question, it depends on a couple of things. Can we grab fifteen minutes so you get a real number?',
    stats: { 'ceo.neutral.buying_signal': [15, 13, 4, 4, 5] },
  },
  {
    slug: 'bs_proof',
    moment: 'buying_signal',
    style: 'proof',
    text: 'Most founders get a quote in one short call. Does Thursday afternoon work?',
    stats: { 'ceo.warm.buying_signal': [6, 5, 2, 2, 1] },
  },

  /* ── close: book it ── */
  {
    slug: 'cl_book',
    moment: 'close',
    style: 'straight',
    text: "Great, I'll send an invite for then. Who else should be on it?",
    stats: { 'ceo.warm.close': [30, 28, 21, 21, 3] },
  },
  {
    slug: 'cl_confirm',
    moment: 'close',
    style: 'question',
    text: 'Perfect. Is this the best email for the invite?',
    stats: { 'ceo.warm.close': [14, 13, 9, 9, 2] },
  },
  {
    slug: 'cl_prep',
    moment: 'close',
    style: 'proof',
    text: 'Done. If you can bring your current policy, we can compare like for like on the call.',
    stats: { 'ceo.warm.close': [5, 5, 3, 3, 0] },
  },

  /* ── compliance: the safe thing to say instead ── */
  {
    slug: 'co_quote',
    moment: 'compliance',
    style: 'straight',
    text: "That's exactly what the quote call will confirm.",
    stats: { 'ceo.neutral.compliance': [19, 17, 15, 3, 1] },
  },
  {
    slug: 'co_underwriting',
    moment: 'compliance',
    style: 'straight',
    text: "I can't promise that before underwriting, but it's exactly what the quote will spell out.",
    stats: { 'ceo.neutral.compliance': [11, 10, 8, 2, 1] },
  },
  {
    slug: 'co_number',
    moment: 'compliance',
    style: 'straight',
    text: "I won't guess at a number, but the quote call gets you a real one in fifteen minutes.",
    stats: { 'ceo.neutral.compliance': [4, 4, 3, 1, 0] },
  },
];

/** The starting playbook: 3–5 active lines for every moment that suggests, with seeded stats. */
export const SEED_PLAYBOOK: PlaybookLine[] = SPECS.map(line);

const UP_NEXT: Partial<Record<Moment, UpNext[]>> = {
  opener: [
    { ifTheySay: '"What\'s this regarding?"', move: 'Name it plainly, then ask for thirty seconds', moment: 'whats_this_regarding' },
    { ifTheySay: '"I\'m busy"', move: 'Offer later today or tomorrow', moment: 'brush_off_busy' },
  ],
  gatekeeper: [
    { ifTheySay: '"She\'s in a meeting"', move: 'Ask when she is usually free', moment: 'gatekeeper' },
    { ifTheySay: '"Can I take a message?"', move: 'Get the best person and time instead', moment: 'gatekeeper' },
  ],
  whats_this_regarding: [
    { ifTheySay: '"We have a broker"', move: 'Ask when they last re-quoted', moment: 'objection_broker' },
    { ifTheySay: '"Send me an email"', move: 'Ask what it should answer', moment: 'brush_off_email' },
  ],
  brush_off_email: [
    { ifTheySay: '"Just send it"', move: 'Confirm the address, ask for fifteen minutes', moment: 'close' },
    { ifTheySay: '"Not interested"', move: "Ask if it's sorted or just low priority", moment: 'objection_not_interested' },
  ],
  brush_off_busy: [
    { ifTheySay: '"Call me later"', move: 'Pin down a time before you hang up', moment: 'objection_timing' },
    { ifTheySay: '"Go on then"', move: 'One question about cover since the raise', moment: 'whats_this_regarding' },
  ],
  objection_broker: [
    { ifTheySay: '"They\'re fine"', move: 'Offer a second quote, no switching', moment: 'objection_not_interested' },
    { ifTheySay: '"What would it cost?"', move: 'Go for the meeting', moment: 'buying_signal' },
  ],
  objection_not_interested: [
    { ifTheySay: '"We\'re sorted"', move: 'Ask when it renews', moment: 'objection_timing' },
    { ifTheySay: '"Send me something"', move: 'Ask what it should answer', moment: 'brush_off_email' },
  ],
  objection_price: [
    { ifTheySay: '"What do you charge?"', move: 'No number yet: offer the quote call', moment: 'buying_signal' },
    { ifTheySay: '"Not now"', move: 'Ask when it renews', moment: 'objection_timing' },
  ],
  objection_timing: [
    { ifTheySay: '"After renewal"', move: 'Get the renewal date', moment: 'objection_timing' },
    { ifTheySay: '"Send me an email"', move: 'Ask what it should answer', moment: 'brush_off_email' },
  ],
  buying_signal: [
    { ifTheySay: '"Thursday works"', move: 'Lock the time, ask who else joins', moment: 'close' },
    { ifTheySay: '"Just send pricing"', move: 'No number before underwriting: offer the call', moment: 'objection_price' },
  ],
  close: [
    { ifTheySay: '"Send me the invite"', move: 'Confirm the email and who joins', moment: 'close' },
    { ifTheySay: '"Let me check with my CFO"', move: 'Invite the CFO too', moment: 'objection_timing' },
  ],
  compliance: [
    { ifTheySay: '"So is it covered?"', move: 'The quote call confirms it', moment: 'buying_signal' },
    { ifTheySay: '"What\'s the price?"', move: 'No number before a quote', moment: 'buying_signal' },
  ],
};

/** The two most likely next prospect moves after a moment, with the move for each. Empty for quiet moments. */
export function upNextFor(moment: Moment): UpNext[] {
  return UP_NEXT[moment]?.map((u) => ({ ...u })) ?? [];
}
