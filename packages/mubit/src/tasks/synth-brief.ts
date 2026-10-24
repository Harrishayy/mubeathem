import { SynthBriefOutput } from '@cue/core';
import type { TaskDef } from './types';

/*
 * The Corgi Brief panel's synthesis (apps/brief/background.js used to send this straight to Gemini).
 * SYNTH and POLICY_BLURB are copied verbatim from there; the instructions are SYNTH + ' ' + POLICY_BLURB,
 * then the input shape and one example in the house style of the other tasks.
 */

const POLICY_BLURB =
  'Corgi underwrites these startup policies (pick ONLY from this list, never invent a product, never search for coverage): '
  + 'Commercial General Liability (CGL) — bodily injury, property damage, premises, customer/vendor visits. '
  + 'Directors & Officers (D&O) — founder, board and investor lawsuits; required by most VCs after a priced round. '
  + 'Technology E&O / Tech & AI Liability — software bugs, outages, SLA breaches, AI errors/hallucinations; required in enterprise MSAs. '
  + 'Cyber Liability — breach, ransomware, privacy, SOC 2 proof-of-insurance. '
  + 'Employment Practices Liability (EPLI) — hiring, firing, harassment, discrimination; kicks in with headcount growth. '
  + 'Fiduciary Liability — 401(k), health, equity and benefits plans (ERISA). '
  + 'Media Liability — ads, published content, defamation, copyright/trademark. '
  + 'Hired and Non-Owned Auto (HNOA) — employees driving personal or rental cars for work. '
  + 'Crime & Fidelity — wire fraud, social engineering, employee theft; often required if they move money. '
  + 'Commercial Umbrella — extra limits stacked over CGL/Auto/EPLI for big-contract requirements. '
  + 'Representations & Warranties (R&W) — only if they are buying/selling a company. '
  + 'Match the company: software/SaaS/AI get Tech E&O and Cyber. Food, CPG, hardware, agencies, and services get CGL first — do NOT recommend Tech E&O unless they sell software. '
  + 'A HIPAA CRM or marketing platform is software, not a hospital or medical device — do not invent clinical, EHR, or "life-safety" risk. '
  + 'Skip CGL for a tiny software shop with no meaningful premises story. Skip EPLI for tiny teams unless they are hiring fast. If they likely already carry general or product liability, suggest D&O or Cyber as the gap, not another GL pitch.';

const SYNTH =
  'You write a tight sales brief from RAW web search snippets (titles, URLs, highlights) plus filings. The snippets are not a brief — you must interpret them.\n'
  + 'Output JSON only: {trigger, blurb, kind, does, targeting, employees, founded, city, stage, valuation, people, risk, policies}.\n'
  + 'trigger: a spoken rewrite of what they do, completing "I saw [TRIGGER]". Same facts as kind/does/blurb, just concrete and spoken. Second person, 5-14 words, start with you\'re + a gerund.\n'
  + 'Shape (copy this style): "you\'re putting voice agents on live steak and home-insurance calls". For a small-business lending marketplace: "you\'re matching small businesses to commercial lenders". For vendor-compliance software: "you\'re chasing supplier certificates across retail vendor networks".\n'
  + 'If you wrote a blurb or does, you MUST write a trigger. Empty ONLY if you do not know what they sell.\n'
  + 'Prefer pages on their own domain. Ignore other hits when they are a different topic that only shares the name (geology, history, a different company).\n'
  + 'If the only signal is a newly registered domain and no product copy, leave trigger/does empty. blurb may say the site has no public product description yet.\n'
  + 'Forbidden: raises, rounds, YC, dollars, hiring, job posts, "you\'re live with [logo]", "enterprise-ready", "AI-powered", "you deploy/build/provide/offer X for sales and support", Corgi products, coverage, liability.\n'
  + 'Naming their industry in the scene is fine ("home-insurance calls", "steak orders") — pitching Corgi is not.\n'
  + 'blurb: exactly two short sentences. 1) what kind of company and where. 2) what they sell and who buys it. No company name. Max 45 words. Do not call a vertical CRM or compliance platform "a software development company".\n'
  + 'kind / does / targeting: short clauses. Empty if unknown.\n'
  + 'employees, founded, city, stage, valuation: only if a snippet or filing states it. Empty if unknown. Never guess.\n'
  + 'people: officers/founders/directors of THIS company only. Never a customer, testimonial author, partner, or journalist.\n'
  + 'risk: ONE sentence. The single biggest insurance-relevant risk this company actually runs, grounded in what they sell. Not a list. Drop invented AI agents, medical devices, hospital ops, or "critical clinical/practice operations" unless sources explicitly say they run those. A HIPAA marketing CRM is data + software risk, not an ER.\n'
  + 'policies: 2-3 items that address THAT risk. name MUST be from the Corgi list, reason one short clause why it is the gap. Tech E&O only if they sell software. Cyber if they handle customer or patient data. Media if they run ads/content for clients. Skip CGL unless premises/in-person ops actually matter. Skip D&O if there is no raise/board story. Skip EPLI for tiny teams.\n'
  + 'Never invent employees, cities, raises, or products. Prefer empty over guessing.';

const INSTRUCTIONS = SYNTH + ' ' + POLICY_BLURB + `

INPUT (JSON in the user message)
- company: the company name.
- domain: their own domain, or "" when unknown.
- sources: the raw snippets and filings as text (company, domain, Form D / Form C lines, Wikidata, GLEIF, domain registration, pages on their own domain, other web hits).

OUTPUT
Every key is required. Use "" for an unknown string and [] for an empty list. policies[].name is copied exactly from the Corgi list.

EXAMPLE
Input: {"company":"Harborline","domain":"harborline.example.com","sources":"Company: Harborline\\nDomain: harborline.example.com\\nForm D: $4.0M sold of $4.0M, first sale 2026-04-02\\nPages on their own domain:\\n1. Harborline | Payroll for restaurant groups — https://harborline.example.com/\\n   Harborline runs payroll, tips and benefits for multi-location restaurant groups in Austin and Dallas.\\n2. About Harborline — https://harborline.example.com/about\\n   Founded in 2023 by Dana Ruiz (CEO) and Omar Hale (CTO). 18 employees."}
Output: {"trigger":"you're running payroll and tips for multi-location restaurant groups","blurb":"A payroll software company based in Texas. It sells payroll, tips and benefits software to multi-location restaurant groups.","kind":"Payroll software","does":"Runs payroll, tips and benefits for restaurant groups","targeting":"Multi-location restaurant groups","employees":"18","founded":"2023","city":"Austin","stage":"","valuation":"","people":[{"name":"Dana Ruiz","role":"CEO"},{"name":"Omar Hale","role":"CTO"}],"risk":"A payroll error or breach exposes employee pay and personal data for every restaurant they serve.","policies":[{"name":"Cyber Liability","reason":"they hold employee pay and identity data"},{"name":"Technology E&O / Tech & AI Liability","reason":"a payroll bug costs customers money"},{"name":"Crime & Fidelity","reason":"they move client payroll funds"}]}

Reply with the JSON object only.`;

export const synthBrief: TaskDef<'synth_brief'> = {
  id: 'synth_brief',
  tier: 'write',
  version: 1,
  instructions: INSTRUCTIONS,
  output: SynthBriefOutput,
  maxOutputTokens: 700,
  temperature: 0.2,
  normalize(o) {
    const seen = new Set<string>();
    return {
      ...o,
      trigger: o.trigger.slice(0, 200),
      blurb: o.blurb.slice(0, 400),
      risk: o.risk.slice(0, 300),
      people: o.people.slice(0, 8),
      policies: o.policies.filter((p) => !seen.has(p.name) && !!seen.add(p.name)).slice(0, 3),
    };
  },
};
