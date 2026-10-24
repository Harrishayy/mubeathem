/**
 * Extreme strings for the gallery's stress toggle and the overflow tests. Each one sits at (or near)
 * its schema maximum so the UI is tested at the contract's limits, not at comfortable lengths.
 */
const fill = (seed: string, len: number) => seed.repeat(Math.ceil(len / seed.length)).slice(0, len);

const company200 = fill('Hyperion Quantum Actuarial Reinsurance & Distributed Ledger Holdings Intercontinental Group of Companies LLP ', 200).trim();
const line320 = fill(
  "Honestly? It's insurance, which I know is the worst cold-call topic there is, but your board changed after the Series A and nobody has re-quoted the D&O since the seed, so give me thirty seconds on why that matters and I promise I'll let you go straight after. ",
  320,
).trim();

export const STRESS = {
  name: 'Maximiliana Alexandrovna Konstantinopoulou-Featherstonehaugh de la Vega',
  title: 'Chief Executive Officer, Co-Founder, Interim Chief Financial Officer and Head of People Operations (EMEA, APAC, LATAM)',
  company: company200,
  line: line320,
  why: fill('Cold, short replies and a cut-off: self-aware beats the pitch here, and it has for months across the whole team. ', 200).trim(),
  evidence: fill('Books 2.1× more than the straight answer with cold CEOs who raised in the last ninety days across 41 calls this quarter ', 200).trim(),
  ifTheySay: fill('We already have a broker and honestly we are very happy with them, they have been with us since ', 120).trim(),
  move: fill('Agree, then ask when they last re-quoted after a raise, and offer a side-by-side quote with no obligation ', 160).trim(),
  /** 60 characters with no break opportunity. */
  token: 'Supercalifragilisticexpialidocious_D&O_Series_A_2026_reprice',
  cjk: '保険の見直しについて三十秒だけお時間をいただけますか。取締役会が変わりましたので。',
  summary: fill('Raised a Series A, ships an AI product to law firms, hiring across three continents, new office in Lisbon, enterprise contracts that require E&O and cyber, and a board that expects D&O to match. ', 400).trim(),
  hook: fill('Their enterprise customers require cyber and E&O certificates before procurement will sign, and two of them asked this quarter. ', 240).trim(),
  long: fill('So the thing is we looked at this last year with someone else and it never went anywhere, and I am not sure why this would be different, but go on. ', 600).trim(),
  emoji: '🚀🧑‍⚖️🌱📈',
} as const;
