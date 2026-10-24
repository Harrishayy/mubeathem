import type { Prospect } from '@cue/core';
import { clean, firstText, labelledValue, nameFromTitle, readEmail, readPhone } from './dom';

/**
 * The contact on a HubSpot record page: name, title, company, phone. Selectors cover the current
 * record UI and the older contact profile; the label and title fallbacks cover whatever comes next.
 */
export const HUBSPOT_SELECTORS = {
  name: [
    '[data-test-id="record-highlight-title"]',
    '[data-selenium-test="highlightTitle"]',
    '[data-selenium-test="contact-name"]',
    '[data-test-id="contact-name"]',
    '[data-testid="record-name"]',
    '.record-highlight h1',
    '[data-selenium-test="profile-highlight"] h1',
  ],
  title: [
    '[data-test-id="record-highlight-subtitle"] [data-test-id="jobtitle"]',
    '[data-selenium-test="highlightSubtitle"] [data-selenium-test="jobtitle"]',
    '[data-selenium-test="contact-jobtitle"]',
    '[data-test-id="jobtitle"]',
  ],
  company: [
    '[data-selenium-test="contact-company"]',
    '[data-test-id="associated-company-name"]',
    '[data-selenium-test="company-chicklet-title"]',
    '[data-test-id="company-chicklet-title"]',
  ],
  subtitle: ['[data-test-id="record-highlight-subtitle"]', '[data-selenium-test="highlightSubtitle"]'],
} as const;

const FACT_LABELS: Record<string, string[]> = {
  stage: ['Lifecycle stage', 'Lifecycle Stage'],
  leadStatus: ['Lead status', 'Lead Status'],
  industry: ['Industry'],
  employees: ['Number of employees', 'Employees', 'Company size'],
  city: ['City'],
  funding: ['Total money raised', 'Funding', 'Last funding round'],
};

/** `/contacts/123/record/0-1/456` or `/contacts/123/contact/456` → `456`. */
export function hubspotContactId(url: string): string | undefined {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\/contacts\/\d+\/(?:record\/0-1|contact)\/(\d+)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export function isHubSpotContactPage(url: string): boolean {
  return hubspotContactId(url) !== undefined;
}

/** "CEO at Lumen Labs" / "CEO · Lumen Labs" → { title, company }. */
export function splitSubtitle(s: string): { title: string; company: string } {
  const t = clean(s);
  const m = t.match(/^(.*?)\s+(?:at|@|·|•|\||-|–)\s+(.+)$/i);
  return m ? { title: clean(m[1]), company: clean(m[2]) } : { title: t, company: '' };
}

export function readHubSpotContact(doc: Document, url: string): Prospect | null {
  const root = doc.body ?? doc;
  let name = firstText(root, HUBSPOT_SELECTORS.name);
  if (!name) name = nameFromTitle(doc.title, ['| HubSpot', '- HubSpot', ' | Contact', ' - Contact']);
  if (/^(contacts?|hubspot|dashboard)$/i.test(name)) name = '';
  let title = firstText(root, HUBSPOT_SELECTORS.title) || labelledValue(root, ['Job title', 'Job Title', 'Title']);
  let company = firstText(root, HUBSPOT_SELECTORS.company) || labelledValue(root, ['Company name', 'Company Name', 'Company']);
  if (!title || !company) {
    const sub = splitSubtitle(firstText(root, HUBSPOT_SELECTORS.subtitle));
    title ||= sub.title;
    company ||= sub.company;
  }
  const phone = readPhone(root);
  const email = readEmail(root);
  if (!name && !phone) return null;

  const facts: Record<string, string> = {};
  for (const [key, labels] of Object.entries(FACT_LABELS)) {
    const v = labelledValue(root, labels);
    if (v && v !== '--') facts[key] = clean(v, 500);
  }
  const crmId = hubspotContactId(url);
  return {
    name: clean(name, 200),
    title: clean(title, 200),
    company: clean(company, 200),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(crmId ? { crmId } : {}),
    facts,
  };
}
