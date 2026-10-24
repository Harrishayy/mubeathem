// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyOverride, readContact, sameProspect } from '../src/context/contact';
import { hubspotContactId, readHubSpotContact, splitSubtitle } from '../src/context/hubspot';
import { justConnected, justEnded, readTrellus, stateFromWord } from '../src/context/trellus';
import { hostIdFor } from '../src/hosts';

const fixture = (name: string) => {
  const html = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
};

const HS_URL = 'https://app.hubspot.com/contacts/2114/record/0-1/90121';

describe('HubSpot contact reader', () => {
  it('reads the current record UI', () => {
    const p = readHubSpotContact(fixture('hubspot-contact.html'), HS_URL);
    expect(p).toMatchObject({ name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', phone: '+14155550142', email: 'maya@lumenlabs.ai', crmId: '90121' });
    expect(p?.facts).toMatchObject({ stage: 'Lead', industry: 'Developer tools', funding: '$12M Series A (Mar)' });
  });

  it('falls back to the title and labelled fields on an unknown layout', () => {
    const p = readHubSpotContact(fixture('hubspot-legacy.html'), 'https://app.hubspot.com/contacts/1/contact/77');
    expect(p).toMatchObject({ name: 'Jordan Blake', title: 'Head of Finance', company: 'Northwind Robotics', phone: '07700 900123', crmId: '77' });
    expect(p?.facts.leadStatus).toBe('Open');
  });

  it('returns null on a page with no contact', () => {
    const doc = new DOMParser().parseFromString('<html><head><title>Contacts | HubSpot</title></head><body><h1>Dashboard</h1></body></html>', 'text/html');
    expect(readHubSpotContact(doc, 'https://app.hubspot.com/contacts/1/objects/0-1/views/all/list')).toBeNull();
  });

  it('survives absurd content without throwing or overflowing the schema limits', () => {
    const long = 'x'.repeat(5000);
    const doc = new DOMParser().parseFromString(`<html><body><h1 data-selenium-test="highlightTitle">${long}</h1><a href="tel:not-a-number">call</a></body></html>`, 'text/html');
    const p = readHubSpotContact(doc, HS_URL)!;
    expect(p.name.length).toBeLessThanOrEqual(200);
    expect(p.phone).toBeUndefined();
  });

  it('parses ids and subtitles', () => {
    expect(hubspotContactId(HS_URL)).toBe('90121');
    expect(hubspotContactId('https://app.hubspot.com/reports')).toBeUndefined();
    expect(hubspotContactId('not a url')).toBeUndefined();
    expect(splitSubtitle('CEO at Lumen Labs')).toEqual({ title: 'CEO', company: 'Lumen Labs' });
    expect(splitSubtitle('Co-founder · Acme')).toEqual({ title: 'Co-founder', company: 'Acme' });
    expect(splitSubtitle('Founder')).toEqual({ title: 'Founder', company: '' });
  });
});

describe('Trellus dialer reader', () => {
  it('reads the state attribute and the dialled contact', () => {
    const doc = fixture('hubspot-contact.html');
    expect(readTrellus(doc)).toMatchObject({ present: true, state: 'idle', dialling: { name: 'Maya Chen', phone: '+14155550142' } });
    doc.getElementById('trellus-dialer')!.setAttribute('data-call-state', 'connected');
    expect(readTrellus(doc).state).toBe('connected');
  });

  it('reads connected from controls and a timer when there is no attribute', () => {
    expect(readTrellus(fixture('trellus-connected.html'))).toMatchObject({ present: true, state: 'connected', dialling: { name: 'Priya Raman', phone: '+44 20 7946 0958' } });
  });

  it('reads ringing and ended', () => {
    expect(readTrellus(fixture('trellus-ringing.html')).state).toBe('dialing');
    expect(readTrellus(fixture('trellus-ended.html')).state).toBe('ended');
  });

  it('inside the Trellus frame, the whole document is the dialer', () => {
    const doc = new DOMParser().parseFromString('<body><p>Connected 00:31</p><button>Hang up</button></body>', 'text/html');
    expect(readTrellus(doc).present).toBe(false);
    expect(readTrellus(doc, { inTrellusFrame: true }).state).toBe('connected');
  });

  it('a cross-origin dialer iframe counts as present but unreadable', () => {
    const doc = new DOMParser().parseFromString('<body><iframe src="https://app.trellus.ai/dialer"></iframe></body>', 'text/html');
    expect(readTrellus(doc)).toEqual({ present: true, state: 'idle' });
  });

  it('never mistakes our own overlay for Trellus', () => {
    const doc = new DOMParser().parseFromString('<body><cue-overlay><div class="trellus-like">Connected</div></cue-overlay></body>', 'text/html');
    expect(readTrellus(doc).present).toBe(false);
  });

  it('maps state words and transitions', () => {
    expect(stateFromWord('connecting')).toBe('dialing');
    expect(stateFromWord('DISCONNECTED')).toBe('ended');
    expect(stateFromWord('in_progress')).toBe('connected');
    expect(stateFromWord('ready')).toBe('idle');
    expect(stateFromWord('banana')).toBeNull();
    expect(justConnected('dialing', 'connected')).toBe(true);
    expect(justConnected('connected', 'connected')).toBe(false);
    expect(justEnded('connected', 'ended')).toBe(true);
    expect(justEnded('idle', 'ended')).toBe(false);
  });
});

describe('contact merge', () => {
  it('merges CRM and dialer, and applies a manual override field by field', () => {
    const doc = fixture('hubspot-contact.html');
    const p = readContact(doc, HS_URL, readTrellus(doc));
    expect(p?.name).toBe('Maya Chen');
    const edited = applyOverride(p, { title: 'Founder & CEO', company: '  ' });
    expect(edited).toMatchObject({ name: 'Maya Chen', title: 'Founder & CEO', company: 'Lumen Labs' });
    expect(sameProspect(p, edited)).toBe(false);
    expect(sameProspect(p, { ...p! })).toBe(true);
  });

  it('uses the dialer contact on Trellus itself', () => {
    const doc = fixture('trellus-connected.html');
    expect(readContact(doc, 'https://app.trellus.ai/dialer', readTrellus(doc))).toMatchObject({ name: 'Priya Raman', phone: '+44 20 7946 0958' });
  });

  it('knows which host it is on', () => {
    expect(hostIdFor('app.hubspot.com')).toBe('hubspot');
    expect(hostIdFor('app-eu1.hubspot.com')).toBe('hubspot');
    expect(hostIdFor('app.trellus.ai')).toBe('trellus');
    expect(hostIdFor('evilhubspot.com')).toBeNull();
    expect(hostIdFor('example.com')).toBeNull();
  });
});
