import type { Contact, ContactListResponse, Prospect, ResearchWarmResponse } from '@cue/core';
import { ActionBar, Button, Chip, EmptyState, ErrorState, Icon, KeyValue, Pane, PaneSection, Skeleton, TextField } from '@cue/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { request, type HealthSummary, type SessionState } from '../../src/messages';
import { webAppUrl, type Settings } from '../../src/settings';
import { ago, outcomeWords, role } from '../../src/ui/format';
import { LastTime } from './LastTime';
import { MicPermission } from './MicPermission';

async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

type Fields = { name: string; title: string; company: string; phone: string };
const EMPTY: Fields = { name: '', title: '', company: '', phone: '' };
type Warm = { state: 'idle' } | { state: 'warming' } | { state: 'ok'; res: ResearchWarmResponse } | { state: 'error' };

const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();
const digits = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '');

/** Starts the pre-call research once per person; the brief is then instant when the call starts. */
function useWarm() {
  const done = useRef(new Map<string, Warm>());
  const [, rerender] = useState(0);
  const warm = (key: string, msg: { contactId: string } | { prospect: Prospect }) => {
    if (done.current.has(key)) return;
    done.current.set(key, { state: 'warming' });
    rerender((n) => n + 1);
    void request<ResearchWarmResponse>({ type: 'research.warm', ...msg }).then((res) => {
      done.current.set(key, res.ok ? { state: 'ok', res: res.data } : { state: 'error' });
      rerender((n) => n + 1);
    });
  };
  const status = (key: string | null): Warm => (key ? (done.current.get(key) ?? { state: 'idle' }) : { state: 'idle' });
  return { warm, status };
}

function warmWords(w: Warm): string {
  if (w.state === 'warming') return 'Cue is reading up on them now, so the brief is ready the moment you start.';
  if (w.state === 'ok') return w.res.configured ? 'Research is under way. The brief will be ready when you start.' : 'Web research is off on the server, so the brief uses their saved details.';
  if (w.state === 'error') return "Cue couldn't start the research early. It will try again when the call starts.";
  return '';
}

/**
 * Before the call: who you're calling. The main path is a saved contact (their details and past calls
 * come with them); the other is the person on the open CRM page, or typed in, with an offer to save
 * them. Picking either starts the research straight away, so the brief is waiting when the call starts.
 */
export function StartCall({ state, settings, onOpenSettings }: { state: SessionState; settings: Settings; onOpenSettings: () => void }) {
  const page = state.page?.prospect ?? null;
  const web = webAppUrl(settings);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<Contact | null>(null);
  const { warm, status } = useWarm();

  // Follow the page's contact until the rep edits a field.
  useEffect(() => {
    if (!touched && page) setFields({ name: page.name, title: page.title, company: page.company, phone: page.phone ?? '' });
  }, [page, touched]);

  // A saved contact: research them now.
  useEffect(() => {
    if (picked) warm(`c:${picked.id}`, { contactId: picked.id });
  }, [picked?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The person on the page: research them now too, and see whether they're already saved.
  const pageKey = page ? `p:${norm(page.name)}|${norm(page.company)}|${digits(page.phone)}` : null;
  useEffect(() => {
    if (!page || !pageKey || picked) return;
    if (page.name.trim() || page.company.trim()) warm(pageKey, { prospect: page });
    if (!page.name.trim()) return;
    let live = true;
    void request<ContactListResponse>({ type: 'contacts.search', q: page.name, limit: 5 }).then((res) => {
      if (!live || !res.ok) return;
      const hit = res.data.items.find(
        (c) =>
          (page.crmId && c.crmId === page.crmId) ||
          (page.email && norm(c.email) === norm(page.email)) ||
          (digits(page.phone).length >= 7 && digits(c.phone) === digits(page.phone)) ||
          (norm(c.name) === norm(page.name) && (!page.company || norm(c.company) === norm(page.company))),
      );
      setMatch(hit ?? null);
    });
    return () => {
      live = false;
    };
  }, [pageKey, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouched(true);
    setFields({ ...fields, [k]: e.target.value });
  };

  const typedProspect = (): Prospect => ({
    ...(page && !touched ? page : {}),
    name: fields.name.trim(),
    title: fields.title.trim(),
    company: fields.company.trim(),
    ...(fields.phone.trim() ? { phone: fields.phone.trim() } : {}),
    facts: page?.facts ?? {},
  });

  const canStart = !!picked || !!fields.name.trim() || !!fields.phone.trim();
  const who = picked ? picked.name : fields.name.trim() || fields.phone.trim();

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canStart) return;
    setBusy(true);
    setError(null);
    const source = state.page?.trellus.present ? 'trellus' : 'cue';
    const tabId = await activeTabId();
    const res = picked
      ? await request({ type: 'session.start', prospect: { name: '', title: '', company: '', facts: {} }, contactId: picked.id, tabId, source })
      : await request({ type: 'session.start', prospect: typedProspect(), tabId, source });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  const pageSource = state.page?.host.includes('hubspot') ? 'HubSpot' : state.page?.trellus.present ? 'Trellus' : null;

  const contactPane = picked ? (
    <PickedContact contact={picked} warm={status(`c:${picked.id}`)} onChange={() => setPicked(null)} />
  ) : (
    <Pane label="Saved contacts" scroll={false} pad="none">
      <p className="sp-explain">{page ? 'Or pick' : 'Pick'} who you're calling from your saved contacts. Their details and how past calls went come with them.</p>
      <ContactPicker web={web} onPick={setPicked} onOpenSettings={onOpenSettings} />
    </Pane>
  );

  const otherPane = picked ? null : (
    <OtherPerson
      fields={fields}
      set={set}
      fromPage={page ? pageSource ?? 'this page' : null}
      warm={pageKey && !touched ? status(pageKey) : { state: 'idle' }}
      match={match}
      onUseMatch={() => match && setPicked(match)}
      onSaved={(c) => setPicked(c)}
      typedProspect={typedProspect}
      ownerRepId={settings.rep.id}
      onSubmit={start}
    />
  );

  return (
    <>
      <main className="sp-main">
        {state.error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{state.error}</span>
          </p>
        )}
        {page ? (
          <>
            {otherPane}
            {contactPane}
          </>
        ) : (
          <>
            {contactPane}
            {otherPane}
          </>
        )}
        <SetupPane state={state} settings={settings} onOpenSettings={onOpenSettings} />
        <p className="sp-foot">
          Past calls, contacts and team numbers are in the Cue app.{' '}
          <a className="sp-link" href={web} target="_blank" rel="noreferrer">
            Open in Cue
            <Icon name="external" size={12} />
            <span className="cue-vh"> (opens in a new tab)</span>
          </a>
        </p>
      </main>
      <footer className="sp-dock" aria-label="Start the call">
        {error && (
          <p className="sp-banner sp-dock__msg" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
        <ActionBar end={<span className="sp-hint sp-dock__who">{canStart ? `Calling ${who}` : 'Pick a contact or type a name first'}</span>}>
          <Button variant="primary" icon="phone" loading={busy} disabled={!canStart} onClick={() => void start()}>
            Start Cue
          </Button>
        </ActionBar>
      </footer>
    </>
  );
}

/* ───────── saved contacts ───────── */

type Search = { state: 'loading' } | { state: 'ok'; data: ContactListResponse } | { state: 'error'; message: string };

/** Search-as-you-type over saved contacts: a combobox with a listbox (arrows, Enter, Escape). */
function ContactPicker({ web, onPick, onOpenSettings }: { web: string; onPick: (c: Contact) => void; onOpenSettings: () => void }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'loading' });
  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(
      () => {
        void request<ContactListResponse>({ type: 'contacts.search', q, limit: 8 }).then((res) => {
          if (n !== seq.current) return;
          setSearch(res.ok ? { state: 'ok', data: res.data } : { state: 'error', message: res.error });
          setActive(0);
        });
      },
      q ? 200 : 0,
    );
    return () => clearTimeout(t);
  }, [q, tick]);

  const items = search.state === 'ok' ? search.data.items : [];
  const optId = (i: number) => `${listId}-o${i}`;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(items.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = items[active];
      if (c) onPick(c);
    } else if (e.key === 'Escape' && q) {
      e.preventDefault();
      setQ('');
    }
  };

  const noneSaved = search.state === 'ok' && search.data.total === 0 && !q.trim();

  return (
    <div className="sp-picker">
      {!noneSaved && search.state !== 'error' && (
        <div className="sp-pad-x">
          <TextField
            label="Search contacts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            maxLength={120}
            placeholder="Name, company or phone"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optId(active) : undefined}
            hint={items.length ? 'Up and down arrows to move, Enter to pick.' : undefined}
          />
        </div>
      )}
      {search.state === 'loading' ? (
        <div className="sp-pad" aria-busy="true">
          <Skeleton lines={3} height={18} />
        </div>
      ) : search.state === 'error' ? (
        <div className="sp-pad sp-stack">
          <ErrorState compact title="Contacts didn't load" message={`Cue couldn't reach its server. ${search.message}`} onRetry={() => setTick((t) => t + 1)} />
          <Button size="sm" variant="ghost" icon="settings" onClick={onOpenSettings}>
            Check the server in Settings
          </Button>
        </div>
      ) : noneSaved ? (
        <EmptyState
          compact
          title="No saved contacts yet"
          action={
            <a className="cue-btn cue-btn--secondary cue-btn--sm" href={`${web.replace(/\/+$/, '')}/#/contacts`} target="_blank" rel="noreferrer">
              <Icon name="plus" size={16} />
              <span className="cue-btn__label">Add contacts in Cue</span>
            </a>
          }
        >
          Add the people you call in the Cue app (or import a CSV) and they show up here. Or use Save to contacts on the person you're calling.
        </EmptyState>
      ) : items.length === 0 ? (
        <p className="sp-empty" role="status">
          No saved contact matches “{q.trim()}”. Type their details below instead.
        </p>
      ) : (
        <ul className="sp-contacts" role="listbox" id={listId} aria-label="Saved contacts">
          {items.map((c, i) => (
            <li
              key={c.id}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className="sp-contact"
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c)}
            >
              <span className="sp-contact__name">{c.name}</span>
              {role(c) && <span className="sp-contact__role">{role(c)}</span>}
              <span className="sp-contact__last">
                {c.lastCalledAt ? (
                  <>
                    {outcomeWords(c.lastOutcome) ?? 'Called'} · {ago(c.lastCalledAt)}
                  </>
                ) : (
                  'Not called yet'
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {search.state === 'ok' && search.data.total > items.length && items.length > 0 && (
        <p className="sp-hint sp-pad-x sp-pad-b">
          Showing {items.length} of {search.data.total}. Type to narrow it down.
        </p>
      )}
    </div>
  );
}

/** The saved contact you're about to call: who they are, research status and how last time went. */
function PickedContact({ contact, warm, onChange }: { contact: Contact; warm: Warm; onChange: () => void }) {
  const first = contact.name.split(' ')[0] || contact.name;
  return (
    <Pane
      label="Calling"
      meta={warm.state === 'warming' ? 'researching' : warm.state === 'ok' && warm.res.configured ? 'brief on its way' : undefined}
      actions={
        <Button size="sm" variant="ghost" onClick={onChange}>
          Change
        </Button>
      }
      scroll={false}
      pad="none"
      as="aside"
    >
      <div className="sp-prospect">
        <h2 className="sp-prospect__name">{contact.name}</h2>
        <p className="sp-prospect__role">{role(contact) ?? 'No title or company saved'}</p>
        <KeyValue
          items={[
            ...(contact.phone ? [{ label: 'Phone', value: <span className="cue-num">{contact.phone}</span> }] : []),
            ...(contact.email ? [{ label: 'Email', value: <span className="sp-code">{contact.email}</span> }] : []),
            { label: 'Calls so far', value: contact.calls ? `${contact.calls} · last ${contact.lastCalledAt ? ago(contact.lastCalledAt) : 'unknown'}` : 'None yet' },
            ...(contact.notes ? [{ label: 'Notes', value: contact.notes }] : []),
          ]}
        />
        {warm.state !== 'idle' && (
          <p className="sp-note" role="status">
            <Icon name="spark" size={14} />
            {warmWords(warm)}
          </p>
        )}
      </div>
      <PaneSection label="Last time">
        <LastTime contactId={contact.id} first={first} />
      </PaneSection>
    </Pane>
  );
}

/* ───────── someone not saved ───────── */

function OtherPerson({
  fields,
  set,
  fromPage,
  warm,
  match,
  onUseMatch,
  onSaved,
  typedProspect,
  ownerRepId,
  onSubmit,
}: {
  fields: Fields;
  set: (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  fromPage: string | null;
  warm: Warm;
  match: Contact | null;
  onUseMatch: () => void;
  onSaved: (c: Contact) => void;
  typedProspect: () => Prospect;
  ownerRepId: string;
  onSubmit: (e: FormEvent) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const p = typedProspect();
    if (!p.name) return;
    setSaving(true);
    setError(null);
    const res = await request<Contact>({
      type: 'contacts.create',
      contact: {
        name: p.name,
        title: p.title,
        company: p.company,
        ...(p.phone ? { phone: p.phone } : {}),
        ...(p.email ? { email: p.email } : {}),
        ...(p.crmId ? { crmId: p.crmId } : {}),
        facts: p.facts,
        ...(ownerRepId ? { ownerRepId } : {}),
      },
    });
    setSaving(false);
    if (res.ok) onSaved(res.data);
    else setError(/already|409|clash|exists/i.test(res.error) ? `${res.error} Search for them above instead.` : res.error);
  };

  return (
    <form onSubmit={onSubmit} className="sp-form" aria-label={fromPage ? 'From this page' : 'Someone not saved'}>
      <Pane
        label={fromPage ? 'From this page' : 'Someone not saved'}
        meta={fromPage ? `read from ${fromPage}` : undefined}
        scroll={false}
        footer={
          <ActionBar>
            <Button variant="secondary" icon="user" size="sm" loading={saving} disabled={!fields.name.trim()} onClick={() => void save()}>
              Save to contacts
            </Button>
          </ActionBar>
        }
      >
        <div className="sp-stack">
          <p className="sp-hint">
            {fromPage ? 'Cue read this person from the page. Fix anything that looks off.' : "Calling someone who isn't saved? Type who it is. Saving them keeps their details and past calls for next time."}
          </p>
          {match && (
            <div className="sp-note">
              <Icon name="user" size={14} />
              <span className="sp-note__body">
                {match.name} is already in your contacts{match.calls ? `, with ${match.calls} past ${match.calls === 1 ? 'call' : 'calls'}` : ''}.
                <Button size="sm" variant="secondary" onClick={onUseMatch}>
                  Use saved contact
                </Button>
              </span>
            </div>
          )}
          <div className="sp-grid">
            <TextField label="Name" value={fields.name} onChange={set('name')} maxLength={200} autoComplete="off" />
            <TextField label="Title" value={fields.title} onChange={set('title')} maxLength={200} optional autoComplete="off" />
            <TextField label="Company" value={fields.company} onChange={set('company')} maxLength={200} optional autoComplete="off" />
            <TextField label="Phone" value={fields.phone} onChange={set('phone')} maxLength={40} optional inputMode="tel" autoComplete="off" />
          </div>
          {warm.state !== 'idle' && (
            <p className="sp-note" role="status">
              <Icon name="spark" size={14} />
              {warmWords(warm)}
            </p>
          )}
          {error && (
            <p className="sp-banner" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </p>
          )}
          {/* Enter in a field starts the call. */}
          <button type="submit" hidden tabIndex={-1} aria-hidden />
        </div>
      </Pane>
    </form>
  );
}

/* ───────── setup ───────── */

type Health = { state: 'checking' } | { state: 'ok'; h: HealthSummary } | { state: 'down'; message: string };

/** What has to work before the dial: the Cue server, the microphone, the dialer. */
function SetupPane({ state, settings, onOpenSettings }: { state: SessionState; settings: Settings; onOpenSettings: () => void }) {
  const [health, setHealth] = useState<Health>({ state: 'checking' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setHealth({ state: 'checking' });
    void request<HealthSummary>({ type: 'server.health' }).then((res) => {
      if (live) setHealth(res.ok ? { state: 'ok', h: res.data } : { state: 'down', message: res.error });
    });
    return () => {
      live = false;
    };
  }, [settings.serverUrl, tick]);

  const trellus = state.page?.trellus;
  return (
    <Pane label="Before you dial" meta={health.state === 'ok' ? 'ready' : undefined} scroll={false} pad="none">
      <p className="sp-explain">Cue needs to reach its server and hear the call. Anything that needs fixing shows here.</p>
      <KeyValue
        className="sp-kv-pad"
        items={[
          {
            label: 'Cue server',
            value:
              health.state === 'checking' ? (
                'Checking…'
              ) : health.state === 'ok' ? (
                <Chip size="sm" tone="ok">
                  Connected
                </Chip>
              ) : (
                <span className="sp-stack">
                  <Chip size="sm" tone="bad">
                    Can't reach it
                  </Chip>
                  <span className="sp-hint">
                    Is it running at <code className="sp-code">{settings.serverUrl}</code>?
                  </span>
                  <span className="sp-row">
                    <Button size="sm" variant="secondary" icon="refresh" onClick={() => setTick((t) => t + 1)}>
                      Try again
                    </Button>
                    <Button size="sm" variant="ghost" icon="settings" onClick={onOpenSettings}>
                      Settings
                    </Button>
                  </span>
                </span>
              ),
          },
          ...(health.state === 'ok'
            ? [{ label: 'Suggestions', value: health.h.mubit ? 'Tailored to each moment by your trained model' : 'From the playbook (the model is not set up on the server)' }]
            : []),
          { label: 'Microphone', value: <MicPermission compact showGranted /> },
          {
            label: 'Dialer',
            value: trellus?.present ? `Trellus is open${trellus.state !== 'none' ? ` (${trellus.state})` : ''}` : 'No Trellus dialer on this tab. You can still start Cue and type what was said.',
          },
        ]}
      />
    </Pane>
  );
}
