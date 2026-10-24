import { CallSummary, Contact, ContactImportResponse, ContactListResponse, TeamResponse } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/store/contacts';
import { MIGRATIONS } from '../src/store/db';
import { json, post, PROSPECT, REP, testServer } from './helpers';
import { DatabaseSync } from 'node:sqlite';
import type { CueServer } from '../src/boot';

const SAM = { id: 'rep_sam', name: 'Sam Okafor' };

let server: CueServer;
afterEach(() => server?.close());

const put = (path: string, body: unknown) => server.app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = async (rep: { id: string; name: string }, outcome: string | null, extra: Record<string, unknown> = {}) => {
  const v = await json(post(server, '/api/calls', { prospect: PROSPECT, rep, ...extra }));
  if (outcome) await post(server, `/api/calls/${v.id}/end`, { outcome });
  return v.id as string;
};

describe('saved contacts', () => {
  it('creates, searches, updates and deletes; email is unique', async () => {
    server = testServer();
    const res = await post(server, '/api/contacts', { name: 'Priya Raman', title: 'COO', company: 'Brightpath', email: 'priya@brightpath.io', facts: { stage: 'Series B' } });
    expect(res.status).toBe(201);
    const c = Contact.parse(await json(res));
    expect(c).toMatchObject({ name: 'Priya Raman', calls: 0, lastCalledAt: null, facts: { stage: 'Series B' } });
    expect((await post(server, '/api/contacts', { name: 'Dup', email: 'PRIYA@brightpath.io' })).status).toBe(409);
    await post(server, '/api/contacts', { name: 'Tom Hale', company: 'Northwind' });

    const found = ContactListResponse.parse(await json(server.app.request('/api/contacts?q=bright')));
    expect(found.total).toBe(1);
    expect(found.items[0]!.id).toBe(c.id);

    const up = Contact.parse(await json(put(`/api/contacts/${c.id}`, { name: 'Priya Raman', title: 'CEO', company: 'Brightpath', email: 'priya@brightpath.io' })));
    expect(up.title).toBe('CEO');
    expect((await server.app.request(`/api/contacts/${c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await server.app.request(`/api/contacts/${c.id}`)).status).toBe(404);
  });

  it('a call from a contact fills the prospect, links the call and stamps the contact', async () => {
    server = testServer();
    const c = Contact.parse(await json(post(server, '/api/contacts', { name: 'Priya Raman', title: 'COO', company: 'Brightpath', phone: '+1 415 555 0100', facts: { stage: 'Series B' } })));
    const v = await json(post(server, '/api/calls', { contactId: c.id, prospect: { name: '', facts: { note: 'met at SaaStr' } }, rep: REP }));
    expect(v.prospect).toMatchObject({ name: 'Priya Raman', title: 'COO', company: 'Brightpath', phone: '+1 415 555 0100', facts: { stage: 'Series B', note: 'met at SaaStr' } });
    expect(v.contactId).toBe(c.id);
    await post(server, `/api/calls/${v.id}/end`, { outcome: 'follow_up' });
    const after = Contact.parse(await json(server.app.request(`/api/contacts/${c.id}`)));
    expect(after).toMatchObject({ calls: 1, lastOutcome: 'follow_up' });
    expect(after.lastCalledAt).not.toBeNull();
    expect((await post(server, '/api/calls', { contactId: 'ct_missing', prospect: {}, rep: REP })).status).toBe(404);
  });

  it('imports a CSV: header aliases, quoted commas, extra columns as facts, updates by email, reasons for skips', async () => {
    server = testServer();
    await post(server, '/api/contacts', { name: 'Old Name', email: 'a@x.io' });
    const csv = ['Full Name,Job Title,Company,Email,Headcount', '"Ng, Ada",CTO,"Acme, Inc",a@x.io,40', 'Ben Ito,VP Sales,Globex,,120', ',,NoName,,', ''].join('\r\n');
    const r = ContactImportResponse.parse(await json(post(server, '/api/contacts/import', { csv, ownerRepId: 'rep_alex' })));
    expect(r).toMatchObject({ imported: 1, updated: 1, skipped: 1 });
    expect(r.errors[0]).toEqual({ line: 4, message: 'Missing name' });
    const all = ContactListResponse.parse(await json(server.app.request('/api/contacts?ownerRepId=rep_alex')));
    const ada = all.items.find((c) => c.email === 'a@x.io')!;
    expect(ada).toMatchObject({ name: 'Ng, Ada', company: 'Acme, Inc', facts: { Headcount: '40' } });
    const bad = ContactImportResponse.parse(await json(post(server, '/api/contacts/import', { csv: 'company,email\nAcme,a@b.c' })));
    expect(bad.errors[0]!.message).toMatch(/name/);
  });

  it('parses RFC 4180 CSV', () => {
    expect(parseCsv('﻿a,b\n"x ""y""","1\n2"\n')).toEqual([
      ['a', 'b'],
      ['x "y"', '1\n2'],
    ]);
  });
});

describe('team history', () => {
  it('filters history by rep, outcome and text and reports the total', async () => {
    server = testServer();
    await call(REP, 'meeting_booked');
    await call(REP, 'not_interested');
    await call(SAM, 'meeting_booked', { prospect: { name: 'Jo Park', title: 'CFO', company: 'Quanta' } });
    await call(SAM, null);

    const mine = await server.app.request('/api/calls?repId=rep_alex');
    expect(mine.headers.get('x-total-count')).toBe('2');
    const rows = (await mine.json()) as unknown[];
    expect(rows.map((r) => CallSummary.parse(r).rep?.id)).toEqual(['rep_alex', 'rep_alex']);
    expect(((await json(server.app.request('/api/calls?outcome=meeting_booked'))) as unknown[]).length).toBe(2);
    expect(((await json(server.app.request('/api/calls?outcome=none'))) as unknown[]).length).toBe(1);
    const q = (await json(server.app.request('/api/calls?q=quanta'))) as CallSummary[];
    expect(q.map((r) => r.prospect.name)).toEqual(['Jo Park']);
    expect(((await json(server.app.request('/api/calls?q=100%25'))) as unknown[]).length).toBe(0);
    const first = (await json(server.app.request('/api/calls?repId=rep_sam')))[0].id as string;
    await post(server, `/api/calls/${first}/feedback`, { outcome: 'follow_up', rating: 3 });
    expect(((await json(server.app.request('/api/calls?debriefed=1'))) as CallSummary[]).map((r) => r.id)).toEqual([first]);
    expect((await server.app.request('/api/calls?limit=0')).status).toBe(400);
  });

  it('carries what went well and badly, the rating and the attitude on each row', async () => {
    server = testServer();
    const id = await call(REP, 'meeting_booked');
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'meeting_booked', rating: 4, attitude: 'curious', whatWorked: 'Opened on their raise', whatDidnt: 'Rushed the close' });
    await server.cue.idle();
    const [row] = (await json(server.app.request('/api/calls'))) as CallSummary[];
    expect(row).toMatchObject({ rating: 4, attitude: 'curious' });
    expect(row!.wentWell).toContain('Opened on their raise');
    expect(row!.wentBadly).toContain('Rushed the close');
    expect(new Set(row!.wentWell!.map((x) => x.toLowerCase())).size).toBe(row!.wentWell!.length);
  });

  it('team board: per-rep numbers, weekly trend and totals; practice calls left out', async () => {
    let t = Date.UTC(2026, 9, 1);
    server = testServer({ now: () => t });
    await call(REP, 'meeting_booked');
    await call(REP, 'voicemail');
    t += 8 * 86_400_000;
    await call(REP, 'not_interested');
    await call(SAM, 'meeting_booked');
    await call(SAM, 'meeting_booked', { source: 'practice' });
    const id = await call(SAM, null);
    await post(server, `/api/calls/${id}/feedback`, { outcome: 'follow_up', rating: 2 });

    const team = TeamResponse.parse(await json(server.app.request('/api/team?weeks=4')));
    const alex = team.members.find((m) => m.rep.id === 'rep_alex')!;
    const sam = team.members.find((m) => m.rep.id === 'rep_sam')!;
    expect(alex).toMatchObject({ calls: 3, connected: 2, booked: 1, bookingRate: 0.5 });
    expect(sam).toMatchObject({ calls: 2, booked: 1, avgRating: 2, debriefed: 1 });
    expect(alex.weekly).toHaveLength(4);
    expect(alex.weekly!.map((w) => w.calls)).toEqual([0, 0, 2, 1]);
    expect(team.totals).toMatchObject({ reps: 2, calls: 5, booked: 2 });
  });

  it('migration 4 backfills rep, rating and cue counts from the event log', () => {
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
    db.prepare("INSERT INTO calls (id, status, source, started_at, prospect_json, rep_json) VALUES ('call_1', 'reviewing', 'cue', 1, '{}', ?)").run(JSON.stringify(SAM));
    const ev = (seq: number, type: string, body: object) => db.prepare('INSERT INTO events (call_id, seq, type, at, json) VALUES (?, ?, ?, ?, ?)').run('call_1', seq, type, seq, JSON.stringify({ type, ...body }));
    ev(1, 'suggestion.shown', { suggestion: { id: 'sug_a' } });
    ev(2, 'suggestion.shown', { suggestion: { id: 'sug_a' } });
    ev(3, 'suggestion.shown', { suggestion: { id: 'sug_b' } });
    ev(4, 'suggestion.action', { suggestionId: 'sug_a', action: 'used' });
    ev(5, 'suggestion.action', { suggestionId: 'sug_b', action: 'dismissed' });
    ev(6, 'feedback.submitted', { feedback: { rating: 3, attitude: 'rushed' } });
    db.exec(MIGRATIONS[3]!);
    expect(db.prepare('SELECT rep_id, rep_name, rating, attitude, cues_shown, cues_used FROM calls').get()).toEqual({
      rep_id: 'rep_sam',
      rep_name: 'Sam Okafor',
      rating: 3,
      attitude: 'rushed',
      cues_shown: 2,
      cues_used: 1,
    });
  });
});
