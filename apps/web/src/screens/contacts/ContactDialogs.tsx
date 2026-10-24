import { CueApiError } from '@cue/client';
import type { Contact, ContactImportResponse, ContactInput } from '@cue/core';
import { ActionBar, Button, Dialog, Hint, StatGrid, TextArea, TextField } from '@cue/ui';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { getApi } from '../../state/api';
import { settingsStore } from '../../state/settings';
import { toast } from '../../state/ui';

type Draft = { name: string; title: string; company: string; phone: string; email: string; crmId: string; facts: string; notes: string };
type Errors = Partial<Record<keyof Draft, string>>;

const EMPTY: Draft = { name: '', title: '', company: '', phone: '', email: '', crmId: '', facts: '', notes: '' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDraft(c: Contact | null): Draft {
  if (!c) return EMPTY;
  return {
    name: c.name,
    title: c.title,
    company: c.company,
    phone: c.phone ?? '',
    email: c.email ?? '',
    crmId: c.crmId ?? '',
    facts: Object.entries(c.facts)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
    notes: c.notes ?? '',
  };
}

/** "Funding: Series A" per line → { Funding: 'Series A' }. Lines without a colon become a numbered note. */
export function parseFacts(text: string): { facts: Record<string, string>; error: string | null } {
  const facts: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i <= 0) return { facts, error: `Write each fact as "Label: value" (this line has no label: "${line.slice(0, 40)}")` };
    const k = line.slice(0, i).trim().slice(0, 60);
    const v = line.slice(i + 1).trim().slice(0, 500);
    if (k && v) facts[k] = v;
  }
  return { facts, error: null };
}

function validate(d: Draft): { errors: Errors; input: ContactInput | null } {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Add a name so you can find them later.';
  if (d.email.trim() && !EMAIL.test(d.email.trim())) errors.email = 'That doesn’t look like an email address.';
  if (d.phone.trim() && !/^[+()\d\s.-]{5,40}$/.test(d.phone.trim())) errors.phone = 'Use digits, spaces, + ( ) - only.';
  const { facts, error } = parseFacts(d.facts);
  if (error) errors.facts = error;
  if (Object.keys(errors).length) return { errors, input: null };
  const owner = settingsStore.get().repId;
  return {
    errors,
    input: {
      name: d.name.trim(),
      title: d.title.trim(),
      company: d.company.trim(),
      ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
      ...(d.email.trim() ? { email: d.email.trim() } : {}),
      ...(d.crmId.trim() ? { crmId: d.crmId.trim() } : {}),
      ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
      facts,
      ...(owner ? { ownerRepId: owner } : {}),
    },
  };
}

export interface ContactFormDialogProps {
  open: boolean;
  /** Edit this contact; null adds a new one. */
  contact: Contact | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
  /** Prefill a new contact (e.g. what was typed on Live). */
  initial?: Partial<Draft>;
}

/** Add or edit a saved contact. Validates before sending; an email that is already saved shows on the field. */
export function ContactFormDialog({ open, contact, onClose, onSaved, initial }: ContactFormDialogProps) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setD({ ...toDraft(contact), ...(contact ? {} : initial) });
    setErrors({});
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact]);

  const set = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { errors: errs, input } = validate(d);
    setErrors(errs);
    setFailure(null);
    if (!input) {
      const first = Object.keys(errs)[0];
      if (first) document.getElementById(`contact-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = contact ? await getApi().updateContact(contact.id, input) : await getApi().createContact(input);
      toast({ tone: 'ok', title: contact ? 'Contact updated' : `${saved.name} saved to contacts` });
      onSaved(saved);
    } catch (err) {
      if (err instanceof CueApiError && err.status === 409) {
        setErrors((x) => ({ ...x, email: 'Another saved contact already has this email.' }));
        document.getElementById('contact-email')?.focus();
      } else {
        setFailure(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} eyebrow="Contacts" title={contact ? `Edit ${contact.name}` : 'Add a contact'} description="Saved contacts fill in the call for you, and Cue researches them before you dial.">
      <form className="web-stack" onSubmit={submit} noValidate aria-label={contact ? 'Edit contact' : 'Add contact'}>
        <div className="web-grid-2">
          <TextField id="contact-name" label="Name" value={d.name} onChange={set('name')} maxLength={200} autoComplete="off" error={errors.name} required />
          <TextField id="contact-title" label="Title" optional value={d.title} onChange={set('title')} maxLength={200} autoComplete="off" placeholder="Head of Operations" />
          <TextField id="contact-company" label="Company" optional value={d.company} onChange={set('company')} maxLength={200} autoComplete="off" />
          <TextField id="contact-phone" label="Phone" optional value={d.phone} onChange={set('phone')} maxLength={40} inputMode="tel" autoComplete="off" error={errors.phone} />
          <TextField id="contact-email" label="Email" optional type="email" value={d.email} onChange={set('email')} maxLength={200} autoComplete="off" error={errors.email} hint="A work email helps research find the right company." />
          <TextField id="contact-crmId" label="CRM id" optional value={d.crmId} onChange={set('crmId')} maxLength={120} autoComplete="off" hint="The record id in HubSpot or your CRM." />
        </div>
        <TextArea id="contact-facts" label="What you know" optional value={d.facts} onChange={set('facts')} rows={3} error={errors.facts} hint={'One per line, like "Funding: Series A, $14M". The brief uses these.'} />
        <TextArea id="contact-notes" label="Notes" optional value={d.notes} onChange={set('notes')} rows={2} maxLength={2000} />
        {failure && (
          <p className="web-note web-note--warn" role="alert">
            Couldn&rsquo;t save: {failure}
          </p>
        )}
        <ActionBar
          end={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
        >
          <Button type="submit" variant="primary" icon="check" loading={busy}>
            {contact ? 'Save changes' : 'Save contact'}
          </Button>
        </ActionBar>
      </form>
    </Dialog>
  );
}

const SAMPLE = 'name,title,company,email,phone\nMaya Chen,CEO,Lumen Labs,maya@lumenlabs.io,+1 415 555 0134';

/** Import contacts from a CSV: pick a file or paste. Shows what was imported, updated and skipped, line by line. */
export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContactImportResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCsv('');
    setFile(null);
    setResult(null);
    setFailure(null);
  }, [open]);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2_000_000) {
      setFailure('That file is over 2 MB. Split it into smaller files.');
      return;
    }
    setFailure(null);
    setFile(f.name);
    setCsv(await f.text());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) {
      setFailure('Choose a CSV file or paste rows first.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await getApi().importContacts(csv, settingsStore.get().repId || undefined);
      setResult(r);
      if (r.imported || r.updated) onImported();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} eyebrow="Contacts" title="Import contacts" description="Bring your call list in from a spreadsheet or your CRM export (CSV)." size="lg">
      {result ? (
        <div className="web-stack" role="status">
          <StatGrid
            columns={3}
            items={[
              { label: 'Added', value: result.imported, note: 'New contacts' },
              { label: 'Updated', value: result.updated, note: 'Matched by email' },
              { label: 'Skipped', value: result.skipped, note: result.skipped ? 'See the lines below' : 'None' },
            ]}
          />
          {result.errors.length > 0 && (
            <div className="web-stack">
              <p className="cue-label">Lines that need a fix</p>
              <ul className="web-import-errors">
                {result.errors.map((er, i) => (
                  <li key={i}>
                    <span className="cue-num">Line {er.line}</span> {er.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ActionBar
            end={
              <Button variant="ghost" onClick={() => setResult(null)}>
                Import more
              </Button>
            }
          >
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </ActionBar>
        </div>
      ) : (
        <form className="web-stack" onSubmit={submit} aria-label="Import contacts">
          <div className="web-import-help">
            <p className="web-small">
              The first row names the columns. Cue recognises <b>name</b> (or Full Name), <b>title</b> (Job Title), <b>company</b>, <b>phone</b>, <b>email</b>, <b>crm id</b> and <b>notes</b>. Any other column is kept as a fact the
              brief can use. A row whose email is already saved updates that contact.
            </p>
            <pre className="web-import-sample" aria-label="Example CSV">{SAMPLE}</pre>
          </div>
          <div className="web-import-file">
            <label className="cue-btn cue-btn--secondary cue-btn--md web-file">
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pick(e)} className="web-file__input" />
              Choose a CSV file
            </label>
            <span className="web-muted web-small">{file ? `Loaded ${file}` : 'Up to 2 MB.'}</span>
          </div>
          <TextArea label="Or paste rows" value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} maxRows={12} placeholder={SAMPLE} spellCheck={false} />
          {failure && (
            <p className="web-note web-note--warn" role="alert">
              {failure}
            </p>
          )}
          <Hint>Nothing is sent until you press Import.</Hint>
          <ActionBar
            end={
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            }
          >
            <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!csv.trim()}>
              Import
            </Button>
          </ActionBar>
        </form>
      )}
    </Dialog>
  );
}

/** Confirm before deleting a contact. */
export function DeleteContactDialog({ contact, onClose, onDeleted }: { contact: Contact | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      await getApi().deleteContact(contact.id);
      toast({ tone: 'ok', title: `${contact.name} deleted` });
      onDeleted(contact.id);
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not delete', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={contact !== null} onClose={onClose} eyebrow="Contacts" title={contact ? `Delete ${contact.name}?` : 'Delete contact?'} description="They leave your contact list. Calls you already made stay in History.">
      <ActionBar
        end={
          <Button variant="ghost" onClick={onClose}>
            Keep
          </Button>
        }
      >
        <Button variant="danger" icon="trash" loading={busy} onClick={() => void del()}>
          Delete contact
        </Button>
      </ActionBar>
    </Dialog>
  );
}
