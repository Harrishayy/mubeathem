import type { CallSummary, Contact } from '@cue/core';
import { ActionBar, Button, Chip, DataTable, EmptyState, ErrorState, Hint, KeyValue, Pane, PaneSection, Skeleton, Sprout, Toolbar, Workspace, type Column } from '@cue/ui';
import { useEffect, useState } from 'react';
import { useMedia } from '../hooks/useMedia';
import { useDebounced } from '../hooks/useDebounced';
import { reducedMotion } from '../lib/motion';
import { useResource } from '../hooks/useResource';
import { getApi } from '../state/api';
import { callStore } from '../state/call';
import { callContact, warmResearch, whenLabel } from '../state/contacts';
import { firstName, settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { openDebrief, toast } from '../state/ui';
import { callStatus } from './History';
import { ContactFormDialog, DeleteContactDialog, ImportDialog } from './contacts/ContactDialogs';
import '../styles/screens/contacts.css';

const PAGE = 100;

const role = (c: Pick<Contact, 'title' | 'company'>) => [c.title, c.company].filter(Boolean).join(' · ');

/**
 * The people you call: a searchable list, the selected person's details and past calls, and the
 * primary action to call them. Add, edit, import and delete open in dialogs over the screen.
 */
export function Contacts() {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const myId = useStore(settingsStore, (s) => s.repId);
  const [mine, setMine] = useState(false);
  const owner = mine && myId ? myId : undefined;
  const [extra, setExtra] = useState<Contact[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const res = useResource((signal) => getApi().contacts({ q: query || undefined, ownerRepId: owner, limit: PAGE }, { signal }), [query, owner]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null | 'new'>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const desktop = useMedia('(min-width: 1080px)');
  const narrow = useMedia('(max-width: 599.98px)');

  useEffect(() => setExtra([]), [query, owner, res.data]);
  const items = res.data ? [...res.data.items, ...extra.filter((x) => !res.data!.items.some((y) => y.id === x.id))] : null;
  const total = res.data?.total ?? 0;
  const current = items?.find((c) => c.id === selected) ?? items?.[0] ?? null;

  useEffect(() => {
    if (current) warmResearch(current.id);
  }, [current?.id]);

  const select = (c: Contact) => {
    setSelected(c.id);
    if (!desktop) requestAnimationFrame(() => document.getElementById('contact-detail')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
  };

  const more = async () => {
    if (!items) return;
    setLoadingMore(true);
    try {
      const r = await getApi().contacts({ q: query || undefined, ownerRepId: owner, limit: PAGE, offset: items.length });
      setExtra((x) => [...x, ...r.items]);
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not load more', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingMore(false);
    }
  };

  const allColumns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Name',
      width: narrow ? undefined : '210px',
      render: (c) => (
        <span className="web-hist-who">
          <span className="web-hist-who__name">{c.name}</span>
          {narrow && <span className="web-muted web-small">{role(c) || 'No title or company yet'}</span>}
          {narrow && <span className="web-small">{c.lastCalledAt ? `Last called ${whenLabel(c.lastCalledAt)}` : 'Not called yet'}</span>}
        </span>
      ),
    },
    { key: 'role', header: 'Title · company', render: (c) => (role(c) ? <span className="web-small">{role(c)}</span> : <span className="web-muted web-small">Not saved</span>) },
    {
      key: 'last',
      header: 'Last called',
      width: '150px',
      className: 'web-nowrap',
      render: (c) =>
        c.lastCalledAt ? (
          <time className="web-small" dateTime={new Date(c.lastCalledAt).toISOString()}>
            {whenLabel(c.lastCalledAt)}
          </time>
        ) : (
          <span className="web-muted web-small">Not yet</span>
        ),
    },
    { key: 'outcome', header: 'Last outcome', width: '184px', className: 'web-nowrap', render: (c) => (c.lastOutcome ? <OutcomeChip outcome={c.lastOutcome} /> : <span className="web-muted web-small">—</span>) },
    { key: 'calls', header: 'Calls', width: '64px', mono: true, align: 'end', render: (c) => c.calls },
  ];
  const columns = narrow ? allColumns.filter((c) => c.key === 'name' || c.key === 'calls') : allColumns;

  const noneAtAll = res.data && total === 0 && !query && !owner;

  return (
    <div className="web-screen">
      <h1 className="web-sr">Contacts</h1>
      <Toolbar label="Contacts">
        <label className="web-contacts-search">
          <span className="web-sr">Search contacts</span>
          <input type="search" className="web-input web-input--sm" placeholder="Search name, company, title or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" autoComplete="off" />
        </label>
        {myId && (
          <span className="cue-filter" role="group" aria-label="Owner">
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Everyone&rsquo;s
            </button>
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Mine
            </button>
          </span>
        )}
        <span className="web-toolbar__end">
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>
            Add contact
          </Button>
          <Button size="sm" variant="secondary" icon="upload" onClick={() => setImporting(true)}>
            Import CSV
          </Button>
        </span>
      </Toolbar>
      <Workspace
        storageKey="contacts"
        drawer={{
          label: 'Contact',
          summary: current?.name,
          children: <ContactDetail contact={current} onEdit={(c) => setEditing(c)} onDelete={setDeleting} empty={!!noneAtAll} />,
        }}
      >
        <Pane
          paneId="contacts"
          label="Contacts"
          focusable={false}
          foldable={false}
          meta={res.data ? (query ? `${total} found` : String(total)) : undefined}
          hint="Pick someone to see what you know and call them. Cue starts reading up on them as soon as you do."
          pad="none"
          footer={
            items && items.length < total ? (
              <ActionBar>
                <Button size="sm" variant="ghost" onClick={() => void more()} loading={loadingMore}>
                  {`Load more (${total - items.length} left)`}
                </Button>
              </ActionBar>
            ) : undefined
          }
        >
          {res.error && !items ? (
            <ErrorState title="Can't load contacts" message={res.error.message} onRetry={res.reload} className="web-pane-pad" />
          ) : !items ? (
            <div className="web-pane-pad" aria-busy="true">
              <Skeleton lines={6} height={20} />
            </div>
          ) : noneAtAll ? (
            <EmptyState
              art={<Sprout state="idle" size={72} />}
              title="No contacts yet"
              action={
                <span className="web-chips">
                  <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                    Add a contact
                  </Button>
                  <Button variant="secondary" icon="upload" onClick={() => setImporting(true)}>
                    Import a CSV
                  </Button>
                </span>
              }
            >
              Save the people you plan to call. Their details fill in the call for you, and Cue reads up on them before you dial.
            </EmptyState>
          ) : (
            <DataTable
              label="Saved contacts"
              columns={columns}
              rows={items}
              rowKey={(c) => c.id}
              selectedKey={current?.id}
              onSelect={select}
              minWidth={narrow ? 0 : 640}
              empty={
                query ? (
                  <EmptyState compact title={`No one matches “${query}”`} action={<Button size="sm" variant="secondary" onClick={() => setQ('')}>Clear search</Button>}>
                    Try part of a name or company, or add them as a new contact.
                  </EmptyState>
                ) : (
                  <EmptyState compact title="No contacts of yours yet" action={<Button size="sm" variant="secondary" onClick={() => setMine(false)}>Show everyone&rsquo;s</Button>}>
                    Contacts you add or import are marked as yours.
                  </EmptyState>
                )
              }
            />
          )}
        </Pane>
      </Workspace>

      <ContactFormDialog
        open={editing !== null}
        contact={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(c) => {
          setEditing(null);
          setSelected(c.id);
          res.reload();
        }}
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onImported={res.reload} />
      <DeleteContactDialog
        contact={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setSelected(null);
          res.reload();
        }}
      />
    </div>
  );
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const st = callStatus({ status: 'ended', outcome });
  return (
    <Chip size="sm" tone={st.tone}>
      {st.label}
    </Chip>
  );
}

function ContactDetail({ contact, onEdit, onDelete, empty }: { contact: Contact | null; onEdit: (c: Contact) => void; onDelete: (c: Contact) => void; empty: boolean }) {
  const id = contact?.id ?? null;
  const calls = useResource((signal) => (id ? getApi().listCalls({ contactId: id, limit: 20 }, { signal }) : Promise.resolve([] as CallSummary[])), [id]);
  const onCall = useStore(callStore, (s) => s.view?.status === 'live');
  const [busy, setBusy] = useState(false);

  if (!contact) {
    return (
      <Pane label="Contact" as="aside" side="drawer" id="contact-detail">
        <EmptyState compact title={empty ? 'Your contacts show here' : 'Pick a contact'}>
          {empty ? 'Add someone or import a list, then pick them to see their details and call them.' : 'Select someone on the left to see their details, past calls and the Call button.'}
        </EmptyState>
      </Pane>
    );
  }

  const first = firstName(contact.name) || contact.name;
  const call = async () => {
    setBusy(true);
    try {
      await callContact(contact);
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not start the call', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const facts = Object.entries(contact.facts);
  const past = calls.data && calls.data.length > 0 ? calls.data : null;

  return (
    <Pane
      label="Contact"
      as="aside"
      side="drawer"
      id="contact-detail"
      pad="none"
      footer={
        <ActionBar
          end={
            <>
              <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(contact)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(contact)}>
                Delete
              </Button>
            </>
          }
        >
          <Button variant="primary" icon="phone" loading={busy} disabled={onCall} onClick={() => void call()}>
            {`Call ${first}`}
          </Button>
        </ActionBar>
      }
    >
      <div className="web-prospect">
        <h2 className="web-prospect__name">{contact.name}</h2>
        <p className="cue-label">{role(contact) || 'No title or company yet'}</p>
        {onCall && <Hint>You&rsquo;re on a call. End it on Live before starting another.</Hint>}
        <KeyValue
          items={[
            { label: 'Phone', value: contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a> : <span className="web-muted">Not saved</span> },
            { label: 'Email', value: contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : <span className="web-muted">Not saved</span> },
            ...(contact.crmId ? [{ label: 'CRM id', value: <span className="cue-num">{contact.crmId}</span> }] : []),
            {
              label: 'Last called',
              value: contact.lastCalledAt ? `${whenLabel(contact.lastCalledAt)}${contact.lastOutcome ? ` · ${callStatus({ status: 'ended', outcome: contact.lastOutcome }).label}` : ''}` : <span className="web-muted">Not called yet</span>,
            },
            { label: 'Calls', value: <span className="cue-num">{contact.calls}</span> },
          ]}
        />
      </div>
      <PaneSection label="What you know" meta={facts.length ? String(facts.length) : undefined} hint={facts.length ? 'Cue folds these into the pre-call brief.' : undefined}>
        {facts.length ? (
          <KeyValue items={facts.map(([k, v]) => ({ label: k, value: v }))} />
        ) : (
          <p className="web-muted web-small">Nothing saved yet. Add facts like funding or headcount with Edit, and the brief will use them.</p>
        )}
      </PaneSection>
      {contact.notes && (
        <PaneSection label="Notes">
          <p className="web-small web-prewrap">{contact.notes}</p>
        </PaneSection>
      )}
      <PaneSection label="Past calls" meta={past ? String(past.length) : undefined}>
        {calls.error && !calls.data ? (
          <p className="web-muted web-small">Can&rsquo;t load their calls: {calls.error.message}</p>
        ) : !calls.data ? (
          <Skeleton lines={2} />
        ) : !past ? (
          <p className="web-muted web-small">{`No calls with ${first} yet. Calls you make from here show up in this list and in History.`}</p>
        ) : (
          <ul className="web-calllist">
            {past.map((c) => {
              const st = callStatus(c);
              return (
                <li key={c.id}>
                  <button type="button" className="web-calllist__item" onClick={() => openDebrief(c.id)}>
                    <span className="web-calllist__head">
                      <Chip size="sm" tone={st.tone}>
                        {st.label}
                      </Chip>
                      {c.rating != null && <span className="cue-num web-small">{`${c.rating}/5`}</span>}
                    </span>
                    <span className="web-small">
                      <time dateTime={new Date(c.startedAt).toISOString()}>{whenLabel(c.startedAt)}</time>
                      {c.rep?.name ? ` · ${c.rep.name}` : ''}
                      {` · ${c.used} of ${c.suggestions} suggestions used`}
                    </span>
                    {c.reviewSummary && <span className="web-muted web-small">{c.reviewSummary}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PaneSection>
    </Pane>
  );
}
