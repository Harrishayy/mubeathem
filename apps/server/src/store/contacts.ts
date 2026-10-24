import { ContactInput, newId, type Contact, type ContactImportResponse, type ContactListQuery, type ContactListResponse, type Prospect } from '@cue/core';
import { tx, type Db } from './db';

interface RawContact {
  id: string;
  name: string;
  title: string;
  company: string;
  phone: string | null;
  email: string | null;
  crm_id: string | null;
  facts_json: string;
  notes: string | null;
  owner_rep_id: string | null;
  created_at: number;
  updated_at: number;
  last_called_at: number | null;
  calls: number;
  last_outcome: string | null;
}

const SELECT = `SELECT c.*,
  (SELECT COUNT(*) FROM calls k WHERE k.contact_id = c.id) AS calls,
  (SELECT k.outcome FROM calls k WHERE k.contact_id = c.id ORDER BY k.started_at DESC LIMIT 1) AS last_outcome
  FROM contacts c`;

/** Header names a CSV may use for each known field (lower-cased, spaces and punctuation dropped). */
const COLUMNS: Record<string, keyof ContactInput> = {
  name: 'name',
  fullname: 'name',
  contact: 'name',
  contactname: 'name',
  title: 'title',
  jobtitle: 'title',
  role: 'title',
  company: 'company',
  companyname: 'company',
  account: 'company',
  organization: 'company',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  email: 'email',
  emailaddress: 'email',
  crmid: 'crmId',
  hubspotid: 'crmId',
  recordid: 'crmId',
  notes: 'notes',
  note: 'notes',
};

/**
 * Saved contacts: the people a team calls. Starting a call from one fills in the prospect, so a rep
 * never types a name and title on the spot. Email is unique (case-insensitive) when present.
 */
export class ContactStore {
  constructor(
    readonly db: Db,
    private now: () => number = Date.now,
  ) {}

  list(q: ContactListQuery = {}): ContactListResponse {
    const w: string[] = [];
    const args: (string | number)[] = [];
    const text = q.q?.trim().toLowerCase();
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      w.push("(lower(c.name) LIKE ? ESCAPE '\\' OR lower(c.company) LIKE ? ESCAPE '\\' OR lower(c.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(c.email, '')) LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    if (q.ownerRepId) w.push('c.owner_rep_id = ?') && args.push(q.ownerRepId);
    const where = w.length ? ` WHERE ${w.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, q.limit ?? 100));
    const offset = Math.max(0, q.offset ?? 0);
    const rows = this.db.prepare(`${SELECT}${where} ORDER BY COALESCE(c.last_called_at, 0) DESC, c.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as RawContact[];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM contacts c${where}`).get(...args) as { n: number }).n;
    return { items: rows.map(toContact), total };
  }

  get(id: string): Contact | null {
    const r = this.db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as RawContact | undefined;
    return r ? toContact(r) : null;
  }

  create(input: ContactInput): Contact {
    const c = ContactInput.parse(input);
    if (c.email && this.byEmail(c.email)) throw new ContactError('conflict', `A contact with ${c.email} already exists`);
    const id = newId('ct', { now: this.now() });
    const at = this.now();
    this.db
      .prepare('INSERT INTO contacts (id, name, title, company, phone, email, crm_id, facts_json, notes, owner_rep_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, c.name, c.title, c.company, c.phone || null, c.email || null, c.crmId || null, JSON.stringify(c.facts), c.notes || null, c.ownerRepId || null, at, at);
    return this.get(id)!;
  }

  update(id: string, input: ContactInput): Contact {
    const c = ContactInput.parse(input);
    if (!this.get(id)) throw new ContactError('not_found', `No contact ${id}`);
    const clash = c.email ? this.byEmail(c.email) : null;
    if (clash && clash !== id) throw new ContactError('conflict', `A contact with ${c.email} already exists`);
    this.db
      .prepare('UPDATE contacts SET name = ?, title = ?, company = ?, phone = ?, email = ?, crm_id = ?, facts_json = ?, notes = ?, owner_rep_id = ?, updated_at = ? WHERE id = ?')
      .run(c.name, c.title, c.company, c.phone || null, c.email || null, c.crmId || null, JSON.stringify(c.facts), c.notes || null, c.ownerRepId || null, this.now(), id);
    return this.get(id)!;
  }

  /** Deletes the contact. Past calls keep their own copy of the prospect. */
  remove(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes) > 0;
  }

  /** The prospect a call starts with. */
  prospect(id: string): Prospect | null {
    const c = this.get(id);
    if (!c) return null;
    return {
      name: c.name,
      title: c.title,
      company: c.company,
      ...(c.phone ? { phone: c.phone } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.crmId ? { crmId: c.crmId } : {}),
      facts: c.facts,
    };
  }

  /**
   * Imports a CSV with a header row. Rows with an email that already exists update that contact;
   * rows without a name are skipped with a reason. Unknown columns become facts.
   */
  importCsv(csv: string, ownerRepId?: string): ContactImportResponse {
    const rows = parseCsv(csv);
    const out: ContactImportResponse = { imported: 0, updated: 0, skipped: 0, errors: [] };
    if (rows.length < 2) {
      out.errors.push({ line: 1, message: 'Needs a header row and at least one contact' });
      return out;
    }
    const header = rows[0]!.map((h) => h.trim());
    const keys = header.map((h) => COLUMNS[h.toLowerCase().replace(/[^a-z]/g, '')] ?? null);
    if (!keys.includes('name')) {
      out.errors.push({ line: 1, message: 'No "name" column in the header' });
      return out;
    }
    const fail = (line: number, message: string) => {
      out.skipped++;
      if (out.errors.length < 100) out.errors.push({ line, message });
    };
    tx(this.db, () => {
      rows.slice(1).forEach((cells, i) => {
        const line = i + 2;
        if (cells.every((c) => !c.trim())) return;
        const raw: Record<string, unknown> = { facts: {} as Record<string, string> };
        cells.forEach((cell, j) => {
          const v = cell.trim();
          if (!v || j >= header.length) return;
          const k = keys[j];
          if (k) raw[k] = v;
          else if (header[j]) (raw.facts as Record<string, string>)[header[j]!.slice(0, 60)] = v.slice(0, 500);
        });
        if (ownerRepId) raw.ownerRepId = ownerRepId;
        const parsed = ContactInput.safeParse(raw);
        if (!parsed.success) return fail(line, parsed.error.issues[0]?.path.join('.') === 'name' ? 'Missing name' : (parsed.error.issues[0]?.message ?? 'Invalid row'));
        const existing = parsed.data.email ? this.byEmail(parsed.data.email) : null;
        if (existing) {
          const prev = this.get(existing)!;
          this.update(existing, { ...parsed.data, facts: { ...prev.facts, ...parsed.data.facts }, notes: parsed.data.notes ?? prev.notes ?? undefined });
          out.updated++;
        } else {
          this.create(parsed.data);
          out.imported++;
        }
      });
    });
    return out;
  }

  private byEmail(email: string): string | null {
    const r = this.db.prepare('SELECT id FROM contacts WHERE email = ? COLLATE NOCASE').get(email) as { id: string } | undefined;
    return r?.id ?? null;
  }
}

export class ContactError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

function toContact(r: RawContact): Contact {
  return {
    id: r.id,
    name: r.name,
    title: r.title,
    company: r.company,
    phone: r.phone,
    email: r.email,
    crmId: r.crm_id,
    facts: JSON.parse(r.facts_json) as Record<string, string>,
    notes: r.notes,
    ownerRepId: r.owner_rep_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastCalledAt: r.last_called_at,
    calls: Number(r.calls ?? 0),
    lastOutcome: r.last_outcome,
  };
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. Also accepts a BOM and semicolons-free Excel output. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
