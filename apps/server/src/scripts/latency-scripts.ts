/**
 * Cold-call transcripts for the latency simulation (latency-sim.ts). Each line is one utterance,
 * replayed at speaking pace with interim chunks. `expect` is the moment a human would label the
 * prospect turn with (used for the moment-accuracy column, never by the pipeline). `gapMs` is the
 * silence before this line starts, measured from the end of the previous line: negative = the
 * speaker cut in before the other finished.
 */
import { DEMO_PROSPECT, DEMO_REP, demoScript, type Moment, type Prospect, type Rep, type Speaker } from '@cue/core';

export interface SimLine {
  speaker: Speaker;
  text: string;
  expect?: Moment;
  gapMs?: number;
}

export interface SimScript {
  id: string;
  title: string;
  prospect: Prospect;
  rep: Rep;
  lines: SimLine[];
}

const REP: Rep = { id: 'rep_sim', name: 'Alex Rivera', tenureDays: 20 };

export const SIM_SCRIPTS: SimScript[] = [
  {
    id: 'demo',
    title: 'Demo call (cold): gatekeeper, broker, buying signal, compliance slip, close',
    prospect: DEMO_PROSPECT,
    rep: DEMO_REP,
    lines: demoScript('cold').map((l) => ({ speaker: l.speaker, text: l.text, ...(l.speaker === 'prospect' && l.expect ? { expect: l.expect } : {}) })),
  },
  {
    id: 'gatekeeper',
    title: 'Gatekeeper wall: screening, message offer, transfer',
    prospect: { name: 'Daniel Okafor', title: 'CEO', company: 'Brightwire', facts: { funding: 'Seed, $4M', product: 'Payments API for marketplaces' } },
    rep: REP,
    lines: [
      { speaker: 'rep', text: 'Hi, this is Alex from Corgi, is Daniel there?' },
      { speaker: 'prospect', text: 'Who is calling please?', expect: 'gatekeeper' },
      { speaker: 'rep', text: "It's Alex at Corgi, we help startups with their insurance after a raise." },
      { speaker: 'prospect', text: "He's on another call right now. Can I take a message?", expect: 'gatekeeper' },
      { speaker: 'rep', text: 'Sure. Is there a better time to catch him today, or does someone else look after insurance?' },
      { speaker: 'prospect', text: 'Um, honestly he handles that himself. What is this in regard to exactly?', expect: 'gatekeeper' },
      { speaker: 'rep', text: "It's about D&O for the board after the seed round. Two minutes with him would do it." },
      { speaker: 'prospect', text: 'Okay. Hold on, let me see if I can put you through.', expect: 'gatekeeper' },
      { speaker: 'prospect', text: 'Daniel speaking.', expect: 'opener', gapMs: 2500 },
      { speaker: 'rep', text: 'Daniel, Alex at Corgi. Congrats on the seed round.' },
      { speaker: 'prospect', text: "Thanks. I'm about to jump into something, what's up?", expect: 'brush_off_busy' },
      { speaker: 'rep', text: "Thirty seconds then. After a raise most boards want D&O in place. Is yours sorted?" },
      { speaker: 'prospect', text: 'Just send me an email and I will look at it.', expect: 'brush_off_email' },
    ],
  },
  {
    id: 'brushoffs',
    title: 'Brush-offs and one-word answers: "yeah", "busy", "not interested"',
    prospect: { name: 'Tom Hartley', title: 'Founder & CEO', company: 'Quillstack', facts: { funding: 'Pre-seed', product: 'LLM evals for legal teams', headcount: '6' } },
    rep: REP,
    lines: [
      { speaker: 'rep', text: "Hi Tom, it's Alex from Corgi. Did I catch you at a bad time?" },
      { speaker: 'prospect', text: 'Yeah.', expect: 'brush_off_busy' },
      { speaker: 'rep', text: "Fair. I'll be quick, it's about insurance for AI products like yours." },
      { speaker: 'prospect', text: "Look I'm slammed, I've got like two minutes.", expect: 'brush_off_busy', gapMs: -300 },
      { speaker: 'rep', text: 'Two minutes is plenty. Has a customer ever asked you for proof of E&O cover?' },
      { speaker: 'prospect', text: 'No.', expect: 'objection_not_interested' },
      { speaker: 'rep', text: "Got it. Usually that question shows up in the first enterprise contract. Worth being ready for it?" },
      { speaker: 'prospect', text: "We're not interested, thanks.", expect: 'objection_not_interested' },
      { speaker: 'rep', text: 'Totally understand. Can I send one page so you have it when a contract asks?' },
      { speaker: 'prospect', text: 'Fine, email it over.', expect: 'brush_off_email' },
    ],
  },
  {
    id: 'objections',
    title: 'Objection run: broker, price, timing, with long rambles',
    prospect: { name: 'Sofia Reyes', title: 'CFO', company: 'Northpeak Robotics', facts: { funding: 'Series B in June', product: 'Warehouse robots', expansion: 'New office in Austin' } },
    rep: REP,
    lines: [
      { speaker: 'rep', text: "Hi Sofia, Alex at Corgi. Saw the Series B and the Austin office, congratulations." },
      { speaker: 'prospect', text: "Thank you. So what's this regarding?", expect: 'whats_this_regarding' },
      { speaker: 'rep', text: 'Insurance after the raise. New board, new office, new robots on customer floors. Who handles that for you today?' },
      {
        speaker: 'prospect',
        text: "So we have a broker, we've had the same broker since basically day one, they did our general liability and the property stuff when we moved into the warehouse, and honestly they've been fine, they pick up the phone, so I'm not really looking to change anything right now.",
        expect: 'objection_broker',
      },
      { speaker: 'rep', text: 'That makes sense. Did they re-quote D&O after the Series B, or is it still the old limit?' },
      { speaker: 'prospect', text: "I'd have to check. But honestly, what does something like this even cost? Our premiums already went up a lot this year.", expect: 'objection_price' },
      { speaker: 'rep', text: 'Fair question. It depends on the round and the board, which is why a fifteen minute quote call beats a guess.' },
      {
        speaker: 'prospect',
        text: "Yeah, the timing is just bad for us. We're in the middle of the audit and our renewal isn't until March, so call me next quarter and maybe we'll take a look then.",
        expect: 'objection_timing',
      },
      { speaker: 'rep', text: 'Understood. If I put fifteen minutes in for early February, before the renewal, would that work?' },
      { speaker: 'prospect', text: 'Early February could work. Send me something.', expect: 'close' },
    ],
  },
  {
    id: 'buying',
    title: 'Fast buying signal: warm engineer, price question, quick close, interruptions',
    prospect: { name: 'Ben Ito', title: 'CTO', company: 'Vectorfold', facts: { funding: 'Seed extension', product: 'AI code review', headcount: '15, hiring' } },
    rep: REP,
    lines: [
      { speaker: 'rep', text: "Hi Ben, it's Alex at Corgi. Quick one about AI liability for code review tools." },
      { speaker: 'prospect', text: "Oh interesting, actually we've been talking about that internally!", expect: 'buying_signal' },
      { speaker: 'rep', text: 'Great timing then. What came up, a customer contract or the board?' },
      { speaker: 'prospect', text: 'A big customer asked if we carry E&O, and we do not. How fast can you quote?', expect: 'buying_signal', gapMs: -400 },
      { speaker: 'rep', text: "Same week usually. Fifteen minutes with our team and they'll quote you live." },
      { speaker: 'prospect', text: 'Roughly how much are we talking?', expect: 'buying_signal' },
      { speaker: 'rep', text: 'It depends on revenue and the contracts, our team will give you the real number on the call. Thursday or Friday?' },
      { speaker: 'prospect', text: 'Friday morning works.', expect: 'close', gapMs: 300 },
      { speaker: 'rep', text: "Perfect, I'll send an invite for Friday at ten. Anyone else who should join?" },
      { speaker: 'prospect', text: 'Just me. Thanks Alex.', expect: 'wrap_up' },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance slip: coverage and price promises by the rep',
    prospect: { name: 'Aisha Patel', title: 'CEO', company: 'Harbourline Health', facts: { funding: 'Series A, $22M', product: 'Remote patient monitoring' } },
    rep: REP,
    lines: [
      { speaker: 'rep', text: "Hi Aisha, it's Alex from Corgi. Saw the Series A, congrats." },
      { speaker: 'prospect', text: "Hi, thanks. What's this about?", expect: 'whats_this_regarding' },
      { speaker: 'rep', text: 'Cyber and E&O for health products. Patient data makes it a board topic fast.' },
      { speaker: 'prospect', text: 'Would a data breach on our side actually be covered by something like that?', expect: 'buying_signal' },
      { speaker: 'rep', text: "Yes, that's guaranteed to be covered, no exclusions." },
      { speaker: 'prospect', text: 'Okay and would it be cheaper than what we pay now?', expect: 'objection_price' },
      { speaker: 'rep', text: "Definitely, we're always cheaper than the big carriers." },
      { speaker: 'prospect', text: "Alright. Let's set up a call with our COO next week.", expect: 'close' },
      { speaker: 'rep', text: "Great, I'll send times for next week." },
      { speaker: 'prospect', text: 'Sounds good, bye.', expect: 'wrap_up' },
    ],
  },
];
