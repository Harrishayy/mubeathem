/**
 * Realistic rep claims for topping up the check_claim task: simulated calls rarely produce risky
 * claims, so the seed adds these. A mix of breaches, safe phrasing and borderline cases.
 */
export const PRE_QUOTE_EVIDENCE = ['No quote has been generated.', 'Underwriting has not started.'];

/** [claim, extra evidence]. */
export const SEED_CLAIMS: [string, string[]][] = [
  ["Yeah, that'd definitely be covered under D&O.", ['Prospect asked about a board dispute.']],
  ["Don't worry, you'd be fully covered for that.", ['Prospect described a past data breach.']],
  ['We guarantee the lowest premium in the market.', []],
  ["You'd be looking at about two grand a year, tops.", ['Prospect asked roughly what it costs.']],
  ['There are no exclusions on our cyber policy.', []],
  ["We'll cover any lawsuit from an AI mistake, full stop.", ['Prospect builds an AI underwriting product.']],
  ["Honestly, we're the cheapest carrier for startups, period.", []],
  ['Your premium would drop by half if you switched.', ['Prospect has an existing broker.']],
  ["It's covered from day one, no questions asked.", []],
  ['I can promise the claim would be paid.', ['Prospect mentioned an ongoing employee dispute.']],
  ["That's exactly what the quote call will confirm.", []],
  ["I can't promise coverage before underwriting, but that's what the quote call is for.", []],
  ['Most founders at your stage look at D&O after a raise.', ['Prospect raised a Series A in March.']],
  ['We price after a short underwriting call, usually same week.', []],
  ['Our team will quote you live on a fifteen-minute call.', []],
  ['AI liability is something we write for a lot of AI-native companies.', ['Prospect builds an AI product.']],
  ["I'd rather not guess a number; the quote call gives you a real one.", ['Prospect asked about price.']],
  ['Cyber cover is often required by enterprise contracts.', ['Prospect sells to enterprises.']],
  ['We can usually beat what your broker quoted.', ['Prospect has an existing broker.']],
  ['Pre-existing incidents would be covered too.', ['Prospect mentioned an incident last year.']],
  ["You won't need any other insurance once you're with us.", []],
  ['EPLI tends to matter more as headcount grows.', ['Prospect has 40 open roles.']],
  ['It would be around $900 a month for your size.', []],
  ['Every policy we write includes AI liability at no extra cost.', []],
  ['We could have you bound by Friday if the numbers work.', []],
  ['Claims are paid within 48 hours, always.', []],
];
