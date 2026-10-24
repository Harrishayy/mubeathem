import type { Prospect } from '@cue/core';
import { hostIdFor, type HostId } from '../hosts';
import { clean, firstText, labelledValue, nameFromTitle, readEmail, readPhone } from './dom';
import { readHubSpotContact } from './hubspot';
import type { TrellusReading } from './trellus';

/** Salesloft / Outreach / Apollo person pages: headline name, then labelled fields. */
export function readGenericContact(doc: Document): Prospect | null {
  const root = doc.body ?? doc;
  const name =
    firstText(root, ['[data-testid*="person-name" i]', '[data-test*="person-name" i]', '[class*="person-name" i]', '[class*="PersonName"]', 'main h1', 'h1']) ||
    nameFromTitle(doc.title, ['| Salesloft', '- Salesloft', '| Outreach', '- Outreach', '| Apollo', '- Apollo']);
  const title = labelledValue(root, ['Title', 'Job title', 'Job Title']);
  const company = labelledValue(root, ['Company', 'Account', 'Company name']);
  const phone = readPhone(root);
  const email = readEmail(root);
  if (!name && !phone) return null;
  return { name: clean(name), title, company, ...(phone ? { phone } : {}), ...(email ? { email } : {}), facts: {} };
}

/** The dialled contact on this page, merging what the dialer shows with what the CRM record says. */
export function readContact(doc: Document, url: string, trellus?: TrellusReading): Prospect | null {
  let host: HostId | null = null;
  try {
    host = hostIdFor(new URL(url).hostname);
  } catch {
    host = null;
  }
  const crm = host === 'hubspot' ? readHubSpotContact(doc, url) : host && host !== 'trellus' ? readGenericContact(doc) : null;
  const d = trellus?.dialling;
  if (!crm && !d) return null;
  return {
    name: crm?.name || d?.name || '',
    title: crm?.title ?? '',
    company: crm?.company ?? '',
    ...(crm?.phone || d?.phone ? { phone: crm?.phone || d?.phone } : {}),
    ...(crm?.email ? { email: crm.email } : {}),
    ...(crm?.crmId ? { crmId: crm.crmId } : {}),
    facts: crm?.facts ?? {},
  };
}

/** Same person? Used to avoid re-rendering (and re-offering Start) on every DOM mutation. */
export function sameProspect(a: Prospect | null, b: Prospect | null): boolean {
  if (!a || !b) return a === b;
  return a.name === b.name && a.title === b.title && a.company === b.company && a.phone === b.phone && a.crmId === b.crmId;
}

/** A manual edit wins field by field over what was read from the page. */
export function applyOverride(read: Prospect | null, override: Partial<Prospect> | null): Prospect | null {
  if (!override) return read;
  const base: Prospect = read ?? { name: '', title: '', company: '', facts: {} };
  const out: Prospect = { ...base, facts: { ...base.facts } };
  for (const k of ['name', 'title', 'company', 'phone'] as const) {
    const v = override[k];
    if (typeof v === 'string' && v.trim()) out[k] = clean(v, k === 'phone' ? 40 : 200);
  }
  return out;
}
