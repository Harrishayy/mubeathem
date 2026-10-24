// Keys, GEMINI_MODEL and seedKey() live in config.js; the Cue server and its token in cue.config.js
// (both gitignored; see README). cue.js is the live call session.
importScripts('config.js');
try { importScripts('cue.config.js'); } catch (_) { /* no Cue server configured: the brief still works */ }
importScripts('cue.js');

const SPV = /\b(L\.?P\.?|Fund|Capital|Ventures|SCSp|Master Fund)\b|a series of|SPV|Co-?Invest/i;
const norm = s => s.toLowerCase().replace(/[.,]/g, '')
  .replace(/\b(inc|corp|corporation|co|llc|ltd|limited|technologies|labs|ai)\b/g, '')
  .replace(/\s+/g, ' ').trim();
const get = (x, n) => {
  const m = String(x || '').match(new RegExp('<(?:[\\w]+:)?' + n + '>([^]*?)</(?:[\\w]+:)?' + n + '>'));
  return m ? m[1].replace(/<[^>]*>/g, '').trim() : '';
};
const num = (x, n) => /^\d+$/.test(get(x, n)) ? +get(x, n) : null;
const numf = (x, n) => {
  const v = get(x, n).replace(/[$,]/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? +v : null;
};
const money = n => {
  if (n == null || !Number.isFinite(+n)) return '?';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e9) return sign + '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return sign + '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) {
    const k = n / 1000;
    return sign + '$' + (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return sign + '$' + Math.round(n);
};

// Catalog is injected into the prompt. The model must pick from these names —
// it does not research the web for products.
const POLICY_NAMES = [
  'Commercial General Liability (CGL)',
  'Directors & Officers (D&O)',
  'Technology E&O / Tech & AI Liability',
  'Cyber Liability',
  'Employment Practices Liability (EPLI)',
  'Fiduciary Liability',
  'Media Liability',
  'Hired and Non-Owned Auto (HNOA)',
  'Crime & Fidelity',
  'Commercial Umbrella',
  'Representations & Warranties (R&W)'
];

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

async function edgar(name) {
  const s = await (await fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${name}"`)}&forms=D`)).json();
  const want = norm(name);
  const best = (s.hits?.hits || []).map(h => {
    const d = (h._source.display_names?.[0] || '').replace(/\s*\(CIK.*/, '');
    const n = norm(d);
    let sc = n === want ? 100 : (n.startsWith(want) || want.startsWith(n)) ? 40 : -20;
    if (SPV.test(d) && !SPV.test(name)) sc -= 50;
    return { sc, cik: h._source.ciks[0], name: d };
  }).sort((a, b) => b.sc - a.sc)[0];
  if (!best || best.sc < 40) return { miss: best ? `closest was ${best.name}` : 'no filing' };

  const sub = await (await fetch(`https://data.sec.gov/submissions/CIK${best.cik}.json`)).json();
  const r = sub.filings.recent;
  const i = r.form.findIndex(f => f[0] === 'D');
  if (i < 0) {
    const other = (r.form || []).find(f => /^(C|C-U|1-A|S-1|10-K)/i.test(f));
    return { miss: other ? `no Form D (has ${other})` : 'no Form D' };
  }
  const allD = r.form.map((f, k) => f[0] === 'D' ? r.filingDate[k] : null).filter(Boolean);

  const x = await (await fetch(`https://www.sec.gov/Archives/edgar/data/${+best.cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i].split('/').pop()}`)).text();
  if (get(x, 'industryGroupType') === 'Pooled Investment Fund') return { miss: 'that match is an SPV' };

  const off = num(x, 'totalOfferingAmount'), sold = num(x, 'totalAmountSold');
  const days = get(x, 'dateOfFirstSale') ? Math.round((Date.now() - Date.parse(get(x, 'dateOfFirstSale'))) / 864e5) : null;

  const people = [];
  for (const b of x.match(/<relatedPersonInfo>[^]*?<\/relatedPersonInfo>/g) || []) {
    const nm = `${(b.match(/<firstName>(.*?)</) || [])[1] || ''} ${(b.match(/<lastName>(.*?)</) || [])[1] || ''}`.trim();
    if (!nm) continue;
    const title = ((b.match(/<relationshipClarification>(.*?)</) || [])[1] || '').trim();
    const rels = [...b.matchAll(/<relatedPersonRelationshipName>(.*?)</g)].map(m => m[1]);
    const offcr = rels.some(v => /Executive Officer/i.test(v));
    const dir = rels.some(v => /Director/i.test(v));
    const role = title || (offcr && dir ? 'Officer & Director' : offcr ? 'Officer' : dir ? 'Director' : rels[0] || '');
    people.push({ name: nm, role });
  }

  const issuer = (x.match(/<primaryIssuer>[^]*?<\/primaryIssuer>/) || [x])[0];
  const yearInc = (x.match(/<yearOfInc>[^]*?<value>(\d{4})</) || [])[1] || '';
  const over5 = /<overFiveYears>\s*true/i.test(x);
  const minInv = num(x, 'minimumInvestmentAccepted');
  const equity = /<isEquityType>\s*true/i.test(x);
  const debt = /<isDebtType>\s*true/i.test(x);
  const etBlock = (issuer.match(/<entityType>[^]*?<\/entityType>/) || [])[0] || '';
  const etKey = (etBlock.match(/<(\w+)>\s*true/i) || [])[1] || '';
  const etMap = {
    corporation: 'Corporation', limitedLiabilityCompany: 'LLC',
    limitedPartnership: 'Limited partnership', generalPartnership: 'General partnership',
    businessTrust: 'Business trust', other: 'Other'
  };

  return {
    sure: best.sc >= 100,
    name: sub.name,
    line: off > sold ? `Round still open — ${money(off - sold)} of ${money(off)} left`
        : days != null && days < 120 ? `Closed ${money(off)}, ${days} days ago` : `Last raise ${money(off)}`,
    off: money(off), sold: money(sold), investors: num(x, 'totalNumberAlreadyInvested'), filed: r.filingDate[i],
    firstRaise: allD.length === 1,
    raises: allD.length,
    prevRaise: allD[1] || null,
    state: get(issuer, 'stateOrCountryDescription'),
    city: get(issuer, 'city'),
    yearInc: yearInc || (over5 ? '2019 or earlier' : ''),
    entityType: etMap[etKey] || '',
    industry: (get(x, 'industryGroupType') || '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    minInvest: minInv != null ? money(minInv) : '',
    securities: equity && debt ? 'Equity + debt' : equity ? 'Equity' : debt ? 'Debt' : '',
    people: uniqPeople(people).slice(0, 8)
  };
}

function uniqPeople(arr) {
  const seen = new Set(), out = [];
  for (const p of arr) {
    const k = (p.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function secXml(cik, accession, doc) {
  const file = String(doc || 'primary_doc.xml').split('/').pop();
  return fetch(`https://www.sec.gov/Archives/edgar/data/${+cik}/${String(accession).replace(/-/g, '')}/${file}`).then(r => r.text());
}

function parseMdY(s) {
  const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
}

function parseProgressDollars(s) {
  let best = null;
  for (const m of String(s || '').matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)) {
    const n = +m[1].replace(/,/g, '');
    if (Number.isFinite(n) && n > (best || 0)) best = n;
  }
  return best;
}

function portalName(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/wefunder/i.test(s)) return 'Wefunder';
  if (/startengine/i.test(s)) return 'StartEngine';
  if (/republic/i.test(s)) return 'Republic';
  if (/dealmaker/i.test(s)) return 'DealMaker';
  if (/netcapital/i.test(s)) return 'Netcapital';
  if (/seedinvest/i.test(s)) return 'SeedInvest';
  if (/andes/i.test(s)) return 'Andes Capital';
  return s.replace(/\s*,?\s*(LLC|L\.L\.C\.|INC|LTD)\.?$/i, '').trim();
}

function sigPeople(x) {
  const out = [];
  for (const b of String(x || '').match(/<signaturePerson>[\s\S]*?<\/signaturePerson>/g) || []) {
    const name = get(b, 'personSignature').replace(/^\/s\/\s*/i, '').trim();
    const role = get(b, 'personTitle').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length > 2 && !/unknown|n\/a/i.test(name)) out.push({ name, role });
  }
  return uniqPeople(out).slice(0, 8);
}

// Regulation Crowdfunding (Wefunder / Republic / StartEngine). Form C is the
// offering; C-U is the progress update with dollars actually in. Most of this
// book files a C and never a D.
async function formC(name) {
  const s = await (await fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${name}"`)}&forms=C`)).json();
  const want = norm(name);
  const best = (s.hits?.hits || []).map(h => {
    const d = (h._source.display_names?.[0] || '').replace(/\s*\(CIK.*/, '');
    const n = norm(d);
    let sc = n === want ? 100 : (n.startsWith(want) || want.startsWith(n)) ? 40 : -20;
    if (want.split(' ').length === 1 && n !== want) sc = -20;
    if (SPV.test(d) && !SPV.test(name)) sc -= 50;
    return { sc, cik: h._source.ciks[0], name: d };
  }).sort((a, b) => b.sc - a.sc)[0];
  if (!best || best.sc < 40) return { miss: best ? `closest was ${best.name}` : 'no filing' };

  const sub = await (await fetch(`https://data.sec.gov/submissions/CIK${best.cik}.json`)).json();
  const r = sub.filings.recent;
  const isOffer = f => /^(C|C\/A)$/i.test(f);
  const isCU = f => /^C-U$/i.test(f);
  const iOffer = r.form.findIndex(isOffer);
  const iU = r.form.findIndex(isCU);
  if (iOffer < 0 && iU < 0) {
    const other = (r.form || []).find(f => /^(C-AR|1-A|D|S-1|10-K)/i.test(f));
    return { miss: other ? `no Form C (has ${other})` : 'no Form C' };
  }

  const i = iOffer >= 0 ? iOffer : iU;
  const x = await secXml(best.cik, r.accessionNumber[i], r.primaryDocument[i]);
  let u = '';
  if (iU >= 0 && iU !== i)
    u = await secXml(best.cik, r.accessionNumber[iU], r.primaryDocument[iU]).catch(() => '');

  const info = (x.match(/<issuerInfo>[\s\S]*?<\/issuerInfo>/) || [x])[0];
  const target = numf(x, 'offeringAmount');
  const cap = numf(x, 'maximumOfferingAmount');
  const deadlineRaw = get(x, 'deadlineDate');
  const deadline = parseMdY(deadlineRaw);
  const progress = get(u || x, 'progressUpdate');
  const sold = parseProgressDollars(progress);
  const open = deadline && deadline.getTime() > Date.now();
  const employees = numf(x, 'currentEmployees');
  const inc = get(info, 'dateIncorporation');
  const yearInc = (inc.match(/(\d{4})$/) || [])[1] || '';
  const portal = portalName(get(x, 'companyName'));
  const security = get(x, 'securityOfferedOtherDesc') || get(x, 'securityOfferedType');

  let line;
  if (open && cap != null)
    line = `Crowdfund still open — ${target != null ? money(target) + ' min, ' : ''}${money(cap)} cap`;
  else if (sold != null && cap != null)
    line = `Crowdfund raised ${money(sold)} of ${money(cap)}`;
  else if (sold != null)
    line = `Crowdfund raised ${money(sold)}`;
  else if (cap != null)
    line = `Reg CF offering, ${money(cap)} cap`;
  else
    line = 'Reg CF offering on file';

  return {
    sure: best.sc >= 100,
    name: get(info, 'nameOfIssuer') || sub.name,
    form: r.form[i],
    line,
    target: target != null ? money(target) : '',
    cap: cap != null ? money(cap) : '',
    sold: sold != null ? money(sold) : '',
    deadline: deadlineRaw.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$1-$2') || deadlineRaw,
    open: !!open,
    portal,
    security: security && security !== 'Other' ? security.replace(/\s+/g, ' ').slice(0, 72) : '',
    employees: employees != null && employees > 0 ? String(Math.round(employees)) : '',
    city: get(info, 'city'),
    state: get(info, 'stateOrCountry'),
    yearInc,
    entityType: get(info, 'legalStatusForm'),
    jurisdiction: get(info, 'jurisdictionOrganization'),
    filed: r.filingDate[i],
    people: sigPeople(x)
  };
}

// Wikidata is free and usually returns in a few hundred ms. Matched by official
// website so "Ramp" does not become On-Ramp Wireless. Misses quietly for the
// long tail of startups — that is expected, the tick just goes ✗.
async function wiki(name, domain) {
  try {
    if (!domain) return { miss: 'no domain' };
    const host = domain.replace(/^www\./, '').replace(/[^\w.-]/g, '');
    const urls = [`https://${host}`, `https://${host}/`, `https://www.${host}`, `https://www.${host}/`,
                  `http://${host}`, `http://www.${host}`];
    const sparql = `
      SELECT ?itemLabel ?inception ?employees ?hqLabel ?ceoLabel ?founderLabel ?chairLabel WHERE {
        VALUES ?url { ${urls.map(u => '<' + u + '>').join(' ')} }
        ?item wdt:P856 ?url .
        OPTIONAL { ?item wdt:P571 ?inception }
        OPTIONAL { ?item wdt:P1128 ?employees }
        OPTIONAL { ?item wdt:P159 ?hq }
        OPTIONAL { ?item wdt:P169 ?ceo }
        OPTIONAL { ?item wdt:P112 ?founder }
        OPTIONAL { ?item wdt:P488 ?chair }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 3`;
    const r = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'query=' + encodeURIComponent(sparql),
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return { miss: 'wiki ' + r.status };
    const rows = (await r.json()).results?.bindings || [];
    if (!rows.length) return { miss: 'no match' };
    const v = (row, k) => (row[k] && row[k].value) || '';
    const row = rows[0];
    const inception = (v(row, 'inception') || '').slice(0, 4);
    const employees = v(row, 'employees');
    const people = uniqPeople([
      v(row, 'ceoLabel') && { name: v(row, 'ceoLabel'), role: 'CEO' },
      v(row, 'founderLabel') && { name: v(row, 'founderLabel'), role: 'Founder' },
      v(row, 'chairLabel') && { name: v(row, 'chairLabel'), role: 'Chair' }
    ].filter(Boolean));
    const used = !!(inception || employees || v(row, 'hqLabel') || people.length);
    if (!used) return { miss: 'empty' };
    return {
      hit: true,
      inception,
      employees: Number.isFinite(Number(employees)) ? String(Math.round(Number(employees))) : '',
      hq: v(row, 'hqLabel'),
      people
    };
  } catch (e) {
    return { miss: e.message || 'wiki failed' };
  }
}

// GLEIF is free, no key. Legal name, HQ, jurisdiction, ACTIVE vs DISSOLVED.
// Most early startups have no LEI — miss is expected. Scoring, not first-hit
// (Stripe Inc → Accent Stripe, Inc. is the same class of miss as EDGAR).
async function gleif(name) {
  try {
    const q = encodeURIComponent(name);
    const r = await fetch('https://api.gleif.org/api/v1/lei-records?page[size]=5&filter[fulltext]=' + q, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return { miss: 'gleif ' + r.status };
    const rows = (await r.json()).data || [];
    const want = norm(name);
    const best = rows.map(rec => {
      const e = (rec.attributes || {}).entity || {};
      const legal = ((e.legalName || {}).name) || '';
      const n = norm(legal);
      let sc = n === want ? 100 : (n.startsWith(want) || want.startsWith(n)) ? 40 : -20;
      // One-word names ("Pronto") prefix-match random Pronto * General Agency LEIs.
      if (want.split(' ').length === 1 && n !== want) sc = -20;
      if (SPV.test(legal) && !SPV.test(name)) sc -= 50;
      const hq = e.headquartersAddress || e.legalAddress || {};
      return {
        sc, legal, status: e.status || '',
        jurisdiction: e.jurisdiction || '',
        city: [hq.city, hq.country].filter(Boolean).join(', '),
        created: (e.creationDate || '').slice(0, 4)
      };
    }).sort((a, b) => b.sc - a.sc)[0];
    if (!best || best.sc < 40) return { miss: best ? 'closest was ' + best.legal : 'no LEI' };
    return { hit: true, ...best };
  } catch (e) {
    return { miss: e.message || 'gleif failed' };
  }
}

// Domain registration date. Redirects to the TLD's RDAP server — those hosts
// must be in host_permissions. Fail quiet if the TLD is not on the list.
async function rdap(domain) {
  if (!domain) return { miss: 'no domain' };
  try {
    const r = await fetch('https://rdap.org/domain/' + encodeURIComponent(domain), {
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return { miss: 'rdap ' + r.status };
    const j = await r.json();
    const ev = j.events || [];
    const reg = ev.find(e => e.eventAction === 'registration');
    const year = (reg && reg.eventDate || '').slice(0, 4);
    if (!year) return { miss: 'no date' };
    return { hit: true, registered: year };
  } catch (e) {
    return { miss: e.message || 'rdap failed' };
  }
}

function abortIn(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function settle(p, ms) {
  return Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise(res => setTimeout(() => res(null), ms))
  ]);
}

async function exaSearch(name, domain, key) {
  if (!key) return null;
  const who = name + (domain ? ' ' + domain : '');
  const once = async (query, type, extra) => {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      signal: abortIn(5000),
      body: JSON.stringify(Object.assign({
        query, type, numResults: 6,
        contents: { highlights: true }
      }, extra || {}))
    });
    if (!r.ok) return null;
    const j = await r.json();
    const results = (j.results || []).map(x => ({
      title: String(x.title || '').trim(),
      url: String(x.url || '').trim(),
      highlights: (Array.isArray(x.highlights) ? x.highlights : [])
        .map(h => String(h || '').replace(/\s+/g, ' ').trim())
        .filter(h => h.length > 24)
        .slice(0, 2)
    })).filter(x => x.url || x.highlights.length);
    return { hit: results.length > 0, type, results };
  };
  const merge = rows => {
    const seen = new Set(), out = [];
    for (const row of rows) {
      const k = (row.url || row.title).toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
    return out;
  };
  try {
    const host = String(domain || '').replace(/^www\./i, '').replace(/\/.*$/, '');
    const [site, use, prod] = await Promise.all([
      host
        ? once(host + ' what the company does', 'instant', { includeDomains: [host] }).catch(() => null)
        : Promise.resolve(null),
      once(who + ' customers use cases who they serve what the product does in production', 'instant').catch(() => null),
      once(who + ' company product', 'instant').catch(() => null)
    ]);
    const results = merge([
      ...(site && site.results || []),
      ...(use && use.results || []),
      ...(prod && prod.results || [])
    ]).slice(0, 10);
    const tagged = pack => {
      if (!pack || !pack.results) return pack;
      const onSite = host
        ? pack.results.filter(x => (x.url || '').toLowerCase().includes(host.toLowerCase())).length
        : pack.results.length;
      return Object.assign({}, pack, { onSite });
    };
    if (results.length) return tagged({ hit: true, type: 'instant', results });
    const fast = await once(who + ' company product customers', 'fast').catch(() => null);
    return tagged(fast && fast.hit ? fast : (site || use || prod));
  } catch (_) { return null; }
}

function tidyTrigger(text) {
  let t = String(text || '').trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/^i saw\s+/i, '');
  t = t.split(/\s*,?\s+but\s+/i)[0];
  t = t.replace(/[.?!]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.replace(/^[A-Z]/, c => c.toLowerCase());
}

function deadOpener(c, name) {
  if (!c) return c;
  const dead = /\b(unfunded|no enterprise customers|researching|following|could not find|no information|appears to be|might be|unclear|has not raised|never raised|no external funding|no funding|since its inception|dissolved|defunct)\b/i;
  const pitch = /\b(liabilit|coverage|doesn'?t cover|does not cover|data breach|product liability|general liability|d\s*&\s*o|this is a cold call|i'?m calling about your|cyber|e\s*&\s*o)\b/i;
  const tagline = /\b(enterprise-?ready|ai-powered|state-of-the-art|cutting-edge|next-gen(?:eration)?|best-in-class|end-to-end|all-in-one)\b/i;
  const productPitch = /^you(?:'re| are)?\s+(?:deploy(?:ing)?|build(?:ing)?|provid(?:e|ing)|offer(?:ing)?|mak(?:e|ing)|sell(?:ing)?|help(?:ing)?|enabl(?:e|ing))\b.+\bfor\b/i;
  const newsHire = /\b(raised?|raising|seed round|your seed|a seed|series [a-f]\b|funding|yc\b|y combinator|closed a|hiring|founding engineer|job post|you(?:'re| are) live with)\b/i;
  const notScene = /^(?:you just|you recently)\b/i;
  const gerund = /^you(?:'re| are)\s+[a-z]+ing\b/i;
  const genericFor = /\bfor\s+(sales(?:\s+and\s+support)?|support(?:\s+and\s+sales)?)\b/i;
  const head = name.replace(/\b(inc|corp|llc|ltd|technologies|labs|ai|health)\b/ig, '')
                   .replace(/[^a-z ]/ig, '').trim().split(/\s+/)[0] || '';
  const lev = (a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = [...Array(a.length + 1)].map((_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i < a.length + 1; i++) for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  const text = tidyTrigger(c.trigger || c.opener);
  const words = text.split(/\s+/).filter(Boolean);
  const caps = text.match(/\b[A-Z][A-Za-z]{3,}\b/g) || [];
  const hay = (name || '').toLowerCase();
  const nearMiss = caps.find(t => {
    if (hay.includes(t.toLowerCase())) return false;
    const d = lev(t, head);
    return d > 0 && d <= 3 && Math.abs(t.length - head.length) <= 4;
  });
  if (!text || words.length < 4) c.blocked = 'nothing specific found';
  else if (words.length > 16) c.blocked = 'trigger too long';
  else if (!gerund.test(text)) c.blocked = 'not a scene';
  else if (notScene.test(text) || newsHire.test(text)) c.blocked = 'news or hire, not a scene';
  else if (dead.test(text)) c.blocked = 'no real signal';
  else if (pitch.test(text)) c.blocked = 'sounds like a generic insurance pitch';
  else if (tagline.test(text) || productPitch.test(text) || genericFor.test(text)) c.blocked = 'homepage restatement';
  else if (nearMiss) c.blocked = 'matched a different company (' + nearMiss + ')';
  else if (/\$/.test(text)) c.blocked = 'quoted a dollar amount';
  if (c.blocked) c.trigger = c.opener = '';
  else c.trigger = c.opener = text;
  return c;
}

function sceneFromDoes(rawDoes, blurb) {
  let d = String(rawDoes || '').trim();
  if (d.slice(-1) === '.') d = d.slice(0, -1);
  if (!d) {
    const parts = String(blurb || '').split('.').map(function (s) { return s.trim(); }).filter(Boolean);
    d = parts[1] || parts[0] || '';
  }
  d = String(d)
    .replace(/^(they|it|the company)\s+/i, '')
    .replace(/^(sells?|provides?|offers?|is|are)\s+/i, '')
    .replace(/^(a|an)\s+/i, '')
    .trim();
  if (d.slice(-1) === '.') d = d.slice(0, -1);
  if (!d) return '';
  if (/^[A-Z]/.test(d)) d = d.charAt(0).toLowerCase() + d.slice(1);
  const head = d.slice(0, 8).toLowerCase();
  if (head.indexOf("you're") === 0 || head.indexOf('you are') === 0) return d;
  if (/^[a-z]+ing\b/i.test(d)) return "you're " + d;
  return ("you're running " + d).split(/\s+/).slice(0, 14).join(' ');
}

function matchPolicy(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return '';
  const exact = POLICY_NAMES.find(p => p.toLowerCase() === n);
  if (exact) return exact;
  const rules = [
    [/r\s*&\s*w|warranties/, 'Representations & Warranties (R&W)'],
    [/d\s*&\s*o|directors/, 'Directors & Officers (D&O)'],
    [/epli|employment practices/, 'Employment Practices Liability (EPLI)'],
    [/e\s*&\s*o|tech(nology)?|ai liability/, 'Technology E&O / Tech & AI Liability'],
    [/cyber/, 'Cyber Liability'],
    [/cgl|general liability/, 'Commercial General Liability (CGL)'],
    [/fiduciary/, 'Fiduciary Liability'],
    [/media/, 'Media Liability'],
    [/hnoa|non-owned|hired/, 'Hired and Non-Owned Auto (HNOA)'],
    [/crime|fidelity/, 'Crime & Fidelity'],
    [/umbrella/, 'Commercial Umbrella']
  ];
  for (const [re, p] of rules) if (re.test(n)) return p;
  return '';
}

function cleanArr(v, min) {
  if (v && !Array.isArray(v)) v = v.value;
  return (Array.isArray(v) ? v : [])
    .filter(x => typeof x === 'string' && x.length > (min || 12) && !/citation|confidence/i.test(x));
}

let state = null;
const edgarCache = new Map();
const formCCache = new Map();
const wikiCache = new Map();
const gleifCache = new Map();
const rdapCache = new Map();
const push = () => {
  chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
  try { Cue.onBrief(state); } catch (_) {}
  try {
    if (state && state.co) chrome.storage.session.set({ briefState: state });
    else chrome.storage.session.remove('briefState');
  } catch (_) {}
};

function geminiText(j) {
  const parts = ((((j.candidates || [])[0] || {}).content || {}).parts) || [];
  return parts.map(p => p.thought ? '' : (p.text || '')).join('').trim();
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; }
}

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function synthPayload(S) {
  const e = S.edgar || {}, c = S.formc || {}, w = S.wiki || {}, g = S.gleif || {}, r = S.rdap || {};
  const host = String(S.co && S.co.domain || '').replace(/^www\./i, '').toLowerCase();
  const rows = list(S.exa && S.exa.results);
  const onSite = host ? rows.filter(x => (x.url || '').toLowerCase().includes(host)) : [];
  const off = host ? rows.filter(x => !(x.url || '').toLowerCase().includes(host)) : rows;
  const fmt = (arr, n) => arr.slice(0, n).map((x, i) => {
    const bits = list(x.highlights).slice(0, 2).map(h => clip(h, 280)).join(' | ');
    return (i + 1) + '. ' + clip(x.title || x.url, 120) + (x.url ? ' — ' + x.url : '') + (bits ? '\n   ' + bits : '');
  }).join('\n');
  return [
    'Company: ' + ((S.co && S.co.name) || ''),
    S.co && S.co.domain && ('Domain: ' + S.co.domain),
    e.line && ('Form D: ' + e.line),
    c.line && ('Form C: ' + c.line),
    w.hit && w.hq && ('Wiki HQ: ' + w.hq),
    w.hit && w.employees && ('Wiki employees: ' + w.employees),
    w.hit && w.inception && ('Wiki founded: ' + w.inception),
    g.hit && g.city && ('GLEIF HQ: ' + g.city),
    r.hit && r.registered && ('Domain registered: ' + r.registered),
    onSite.length && ('Pages on their own domain:\n' + fmt(onSite, 6)),
    off.length && ('Other web hits (ignore if they are a different topic that merely shares the name):\n' + fmt(off, 6)),
    !onSite.length && !off.length && 'No web snippets.'
  ].filter(Boolean).join('\n');
}

function list(v) { return (Array.isArray(v) ? v : []).filter(Boolean); }

function coHost(S) {
  return String(S && S.co && S.co.domain || '').replace(/^www\./i, '').toLowerCase();
}

function siteRows(S) {
  const host = coHost(S);
  const rows = list(S.exa && S.exa.results);
  if (!host) return rows;
  return rows.filter(x => (x.url || '').toLowerCase().includes(host));
}

const NAME_COLLISION = /\b(miocene|fossil|sediment|geological|nannofossil|diatom|paleontol|cretaceous|jurassic|epoch|stratigraph)\b/i;
const EMPTY_SITE = /\bno public product|no product (copy|description)|shares the name\b/i;

function fillFromExa(S, v) {
  v = v && typeof v === 'object'
    ? v
    : { trigger: '', blurb: '', risk: '', policies: [], people: [], facts: {} };
  const name = (S.co && S.co.name) || '';
  const hay = [v.blurb, v.trigger, v.facts && v.facts.does, v.facts && v.facts.blurb].filter(Boolean).join(' ');
  if (NAME_COLLISION.test(hay)) {
    v.trigger = '';
    v.blurb = '';
    if (v.facts) v.facts = Object.assign({}, v.facts, { blurb: '', does: '', kind: '' });
  }
  if (String(v.blurb || '').trim()) {
    if (!v.trigger) {
      const t = deadOpener({ trigger: sceneFromDoes(v.facts && v.facts.does, v.blurb) }, name);
      if (t && t.trigger) v.trigger = t.trigger;
    }
    return v;
  }
  const on = siteRows(S);
  const bits = on.flatMap(x => list(x.highlights))
    .filter(h => h.length > 30 && !NAME_COLLISION.test(h))
    .slice(0, 3);
  const text = bits.join(' ');
  let blurb = '';
  if (text) blurb = clip(text.replace(/\s+/g, ' '), 240);
  else if (S.rdap && S.rdap.registered)
    blurb = 'Domain registered ' + S.rdap.registered + '. No public product description yet.';
  else if (list(S.exa && S.exa.results).length)
    blurb = 'Search hits another topic that shares the name. No product copy on their domain.';
  if (!blurb) return v;
  v.blurb = blurb;
  v.facts = Object.assign({}, v.facts, { blurb });
  if (!EMPTY_SITE.test(blurb) && !v.trigger) {
    const t = deadOpener({ trigger: sceneFromDoes(v.facts && v.facts.does, blurb) }, name);
    if (t && t.trigger) v.trigger = t.trigger;
  }
  return v;
}

async function synthBrief(S) {
  const { geminiKey } = await chrome.storage.local.get('geminiKey');
  const key = geminiKey || (typeof DEFAULT_GEMINI_KEY === 'string' && DEFAULT_GEMINI_KEY) || '';
  if (!key) return null;
  const model = (typeof GEMINI_MODEL === 'string' && GEMINI_MODEL) || 'gemini-3.5-flash-lite';
  let j = null;
  try {
    const ask = think => fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortIn(8000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYNTH + ' ' + POLICY_BLURB }] },
          contents: [{ role: 'user', parts: [{ text: synthPayload(S) }] }],
          generationConfig: Object.assign(
            { maxOutputTokens: 700, responseMimeType: 'application/json' },
            think ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : {}
          )
        })
      }
    );
    let r = await ask(true);
    if (!r.ok) r = await ask(false);
    if (!r.ok) return null;
    j = parseJson(geminiText(await r.json()));
  } catch (_) { return null; }
  if (!j || typeof j !== 'object') return null;
  const opener = deadOpener({ trigger: j.trigger || j.opener || '' }, (S.co && S.co.name) || '');
  if (opener && !opener.trigger) {
    const fallback = sceneFromDoes(j.does, j.blurb);
    if (fallback) {
      const again = deadOpener({ trigger: fallback }, (S.co && S.co.name) || '');
      if (again && again.trigger) {
        opener.trigger = opener.opener = again.trigger;
        opener.blocked = '';
      }
    }
  }
  let risk = clip(j.risk || list(j.risks)[0] || '', 220);
  if (risk.length < 12) risk = '';
  const policies = (Array.isArray(j.policies) ? j.policies : [])
    .map(p => typeof p === 'string'
      ? { name: matchPolicy(p), reason: '' }
      : { name: matchPolicy(p && p.name), reason: String(p && p.reason || '').trim() })
    .filter(p => p.name)
    .slice(0, 3);
  const people = uniqPeople((Array.isArray(j.people) ? j.people : [])
    .map(p => ({ name: String(p && p.name || '').trim(), role: String(p && p.role || '').trim() }))
    .filter(p => p.name.length > 1 && !/citation|unknown|n\/a|testimonial/i.test(p.name)))
    .slice(0, 8);
  const field = k => clip(j[k] || '', 80);
  const facts = {
    kind: field('kind'),
    does: clip(j.does || '', 160),
    targeting: clip(j.targeting || '', 160),
    blurb: String(j.blurb || '').replace(/\s+/g, ' ').trim(),
    employees: field('employees'),
    founded: field('founded'),
    city: field('city'),
    stage: field('stage') === 'unclear' ? '' : field('stage'),
    valuation: field('valuation')
  };
  return {
    trigger: opener && opener.trigger || '',
    blurb: facts.blurb,
    risk,
    policies,
    people,
    facts
  };
}

async function loadState() {
  if (state) return state;
  try {
    const s = await chrome.storage.session.get('briefState');
    if (!state && s.briefState && s.briefState.co) state = s.briefState;
  } catch (_) {}
  return state;
}

function recId(s) {
  const m = String(s || '').match(/(\d+-\d+)\/(\d+)/);
  return m ? m[1] + '/' + m[2] : '';
}

const getEdgar = name => {
  if (!edgarCache.has(name))
    edgarCache.set(name, edgar(name).catch(e => ({ miss: e.message })));
  return edgarCache.get(name);
};
const getFormC = name => {
  if (!formCCache.has(name))
    formCCache.set(name, formC(name).catch(e => ({ miss: e.message })));
  return formCCache.get(name);
};
const getWiki = (name, domain) => {
  const k = domain || name;
  if (!wikiCache.has(k))
    wikiCache.set(k, wiki(name, domain).catch(e => ({ miss: e.message })));
  return wikiCache.get(k);
};
const getGleif = name => {
  if (!gleifCache.has(name))
    gleifCache.set(name, gleif(name).catch(e => ({ miss: e.message })));
  return gleifCache.get(name);
};
const getRdap = domain => {
  const k = domain || '';
  if (!rdapCache.has(k))
    rdapCache.set(k, rdap(domain).catch(e => ({ miss: e.message })));
  return rdapCache.get(k);
};

let pageGateOpen = true;
let pageGateTimer = null;
let pendingDismiss = null;

function lockPageGate() {
  pageGateOpen = false;
  clearTimeout(pageGateTimer);
  clearTimeout(pendingDismiss);
  pendingDismiss = null;
  pageGateTimer = setTimeout(() => { pageGateOpen = true; }, 6500);
}

function openPageGate(record) {
  clearTimeout(pageGateTimer);
  clearTimeout(pendingDismiss);
  pendingDismiss = null;
  pageGateOpen = true;
  if (state && state.co && record) state.co.pageRecord = record;
}

function considerDismiss(record) {
  if (!state || !state.co) return;
  const now = recId(record);
  if (!pageGateOpen) {
    if (now) state.co.pageRecord = record;
    return;
  }
  const held = recId(state.co.pageRecord);
  if (!held && now) {
    state.co.pageRecord = record;
    clearTimeout(pendingDismiss);
    pendingDismiss = null;
    return;
  }
  if (!now || !held || now === held) {
    clearTimeout(pendingDismiss);
    pendingDismiss = null;
    return;
  }
  clearTimeout(pendingDismiss);
  pendingDismiss = setTimeout(() => {
    pendingDismiss = null;
    if (!pageGateOpen || !state || !state.co) return;
    if (now !== recId(state.co.pageRecord)) { state = null; push(); }
  }, 400);
}

async function brief(co, { force, onCall } = {}) {
  const gap = force ? 500 : 1200;
  if (state?.co?.key === co.key && Date.now() - (state.t0 || 0) < gap) {
    if (onCall && state) { state.onCall = true; push(); }
    return;
  }
  state = { co, t0: Date.now(), onCall: !!onCall };
  push();
  const { exaKey } = await chrome.storage.local.get('exaKey');
  if (!exaKey) return fail('No Exa key in storage. Check DEFAULT_EXA_KEY in config.js.');
  const still = () => state && state.co && state.co.key === co.key;
  if (!still()) return;
  const leg = (k, p) => p.then(v => { if (still()) { state[k] = v; push(); } });
  leg('edgar', getEdgar(co.name));
  leg('formc', getFormC(co.name));
  leg('wiki', getWiki(co.name, co.domain));
  leg('gleif', getGleif(co.name));
  leg('rdap', getRdap(co.domain));
  const exaRaw = exaSearch(co.name, co.domain, exaKey).catch(() => null);
  const exaP = settle(exaRaw, 6000);
  leg('exa', exaP);
  exaRaw.then(v => { if (still() && v && v.hit) { state.exa = v; push(); } });
  exaP.then(async () => {
    if (!still()) return;
    await Promise.all([
      settle(getEdgar(co.name), 1200),
      settle(getFormC(co.name), 1200)
    ]);
    if (!still()) return;
    const raw = await settle(synthBrief(state), 9000);
    if (!still()) return;
    const v = fillFromExa(state, raw);
    state.synth = v;
    if (v && v.facts) state.facts = Object.assign({}, state.facts, v.facts);
    push();
  });
  setTimeout(() => {
    if (!still()) return;
    let hit = false;
    for (const k of ['exa', 'synth']) {
      if (state[k] === undefined) { state[k] = null; hit = true; }
    }
    if (hit) push();
  }, 12000);
}

function warm() {
  fetch('https://efts.sec.gov/LATEST/search-index?q=%22a%22&forms=D').catch(() => {});
  fetch('https://efts.sec.gov/LATEST/search-index?q=%22a%22&forms=C').catch(() => {});
  fetch('https://api.exa.ai/search', { method: 'OPTIONS' }).catch(() => {});
  fetch('https://query.wikidata.org/sparql', { method: 'OPTIONS' }).catch(() => {});
  fetch('https://api.gleif.org/api/v1/lei-records?page[size]=1&filter[fulltext]=a', {
    headers: { Accept: 'application/vnd.api+json' }
  }).catch(() => {});
}

const openPanel = tabId => tabId && chrome.sidePanel.open({ tabId }).catch(() => {});

chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m.type === 'panel-ready') {
    warm();
    loadState().then(st => reply({ state: st }));
    return true;
  }
  if (m.type === 'brief-page') { briefActiveTab(); return; }
  if (m.type === 'prewarm') { getEdgar(m.name); getFormC(m.name); return; }
  if (m.type === 'connect') {
    openPanel(s.tab && s.tab.id);
    const co = { ...m };
    delete co.type;
    delete co.pageRecord;
    lockPageGate();
    brief(co, { force: true, onCall: true });
    Cue.onConnect(co, s.tab && s.tab.id);
    return;
  }
  if (m.type === 'disconnect') {
    if (state) { state.onCall = false; push(); }
    Cue.onDisconnect();
    return;
  }
  if (m.type === 'cue-get') { Cue.view().then(cue => reply({ cue })); return true; }
  if (m.type === 'cue-outcome') { Cue.outcome(m.outcome); return; }
  if (m.type === 'cue-dismiss') { Cue.dismiss(); return; }
  if (m.type === 'cue-mic') { chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }); return; }
  if (m.type === 'mic-granted') { Cue.view().then(v => v && v.tabId && Cue.listenHere(v.tabId)); return; }
  if (m.type === 'capture-status' || m.type === 'stt-refresh') { Cue.onOffscreen(m); return; }
  if (m.type === 'page') {
    if (!state || !state.co) return;
    if (m.settle) { openPageGate(m.record); return; }
    considerDismiss(m.record);
  }
});

async function briefActiveTab(tab) {
  if (!tab || !tab.id) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return fail('No active tab.');
  const host = (() => { try { return new URL(tab.url).host; } catch (_) { return ''; } })();
  if (!/(^|\.)hubspot\.com$/i.test(host))
    return fail('Not a HubSpot tab — this one is "' + (host || tab.url || 'unknown') + '". Click the HubSpot tab, then try again.');

  openPanel(tab.id);

  let co = await readTab(tab.id);
  if (co === 'NO_SCRIPT') {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      co = await readTab(tab.id);
    } catch (e) { return fail('Could not inject into this tab: ' + e.message); }
  }
  if (co === 'NO_SCRIPT') return fail('Content script will not load on this tab. Reload the page.');
  if (!co) return fail('No company found on this page. Open a contact or company record.');
  brief(co, { force: true });
}

function readTab(tabId) {
  return new Promise(res => {
    chrome.tabs.sendMessage(tabId, { k: 'read' }, r => {
      if (chrome.runtime.lastError) return res('NO_SCRIPT');
      res(r || null);
    });
  });
}

function fail(msg) {
  state = { error: msg, t0: Date.now() };
  push();
}

chrome.commands.onCommand.addListener((c, tab) => {
  if (tab && tab.id) openPanel(tab.id);
  // The shortcut is a user gesture on this tab, so Chrome lets Cue capture its audio.
  if (c === 'listen') { if (tab && tab.id) Cue.listenHere(tab.id); return; }
  briefActiveTab(tab);
});

const behave = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(behave);
chrome.runtime.onStartup.addListener(behave);
behave();
loadState();

chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [2],
  addRules: [{
    id: 2,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'content-security-policy-report-only', operation: 'remove' }
      ]
    },
    condition: {
      resourceTypes: ['sub_frame'],
      initiatorDomains: [chrome.runtime.id]
    }
  }]
}).catch(() => {});

// Hot reload while developing: set DEV = true. It polls once a second forever, so keep it off when shared.
const DEV = false;
const WATCH = ['manifest.json', 'rules.json', 'background.js', 'content.js', 'cue.js', 'offscreen.js',
               'sidepanel.html', 'sidepanel.js', 'live.js', 'config.js', 'cue.config.js', 'icons/logo.svg'];
const POLL_MS = 1000;
const fileHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

async function fingerprint() {
  const parts = await Promise.all(WATCH.map(async f => {
    try {
      const r = await fetch(chrome.runtime.getURL(f), { cache: 'no-store' });
      return f + ':' + fileHash(await r.text());
    } catch { return f + ':missing'; }
  }));
  return parts.join('|');
}

async function watchDev() {
  if (!DEV) return;
  let baseline = await fingerprint();
  setInterval(async () => {
    const now = await fingerprint();
    if (now === baseline) return;
    baseline = now;
    await chrome.storage.local.set({ __devReloaded: true });
    chrome.runtime.reload();
  }, POLL_MS);
}

async function afterReload() {
  const { __devReloaded } = await chrome.storage.local.get('__devReloaded');
  if (!__devReloaded) return;
  await chrome.storage.local.remove('__devReloaded');
  for (const t of await chrome.tabs.query({ url: 'https://*.hubspot.com/*' }))
    chrome.tabs.reload(t.id).catch(() => {});
}

setTimeout(() => { afterReload(); watchDev(); }, 0);
