/**
 * Where the overbar runs. The dialer (Trellus) lives inside the CRM tab, so these are the CRM and
 * sequencer hosts reps call from, plus Trellus's own web app.
 */
export const HOSTS = [
  { id: 'hubspot', label: 'HubSpot', match: '*://*.hubspot.com/*' },
  { id: 'trellus', label: 'Trellus', match: '*://*.trellus.ai/*' },
  { id: 'salesloft', label: 'Salesloft', match: '*://*.salesloft.com/*' },
  { id: 'outreach', label: 'Outreach', match: '*://*.outreach.io/*' },
  { id: 'apollo', label: 'Apollo', match: '*://*.apollo.io/*' },
] as const;

export type HostId = (typeof HOSTS)[number]['id'];

/** `app.trellus.ai` is covered by `*.trellus.ai`; listed because the brief (and reviewers) look for it. */
export const CONTENT_MATCHES: string[] = [...HOSTS.map((h) => h.match), '*://app.trellus.ai/*'];

/** Which host a page belongs to, or null when the overbar shouldn't know it. */
export function hostIdFor(hostname: string): HostId | null {
  const h = hostname.toLowerCase();
  for (const host of HOSTS) {
    const domain = host.match.replace('*://*.', '').replace('/*', '');
    if (h === domain || h.endsWith(`.${domain}`)) return host.id;
  }
  return null;
}
