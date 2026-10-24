import type { Contact, Prospect } from '@cue/core';
import { ActionBar, Button, Chip, Hint, Kbd, Pane, PaneSection, TextField, Workspace, useWorkspace } from '@cue/ui';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useDebounced } from '../../hooks/useDebounced';
import { useResource } from '../../hooks/useResource';
import { getApi } from '../../state/api';
import { startCall } from '../../state/call';
import { callContact, currentRep, warmResearch, whenLabel } from '../../state/contacts';
import { firstName, settingsStore, updateSettings } from '../../state/settings';
import { useStore } from '../../state/store';
import { toast } from '../../state/ui';
import { callStatus } from '../History';
import { ContactFormDialog, ImportDialog } from '../contacts/ContactDialogs';
import '../../styles/screens/live.css';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const EMPTY = { name: '', title: '', company: '', phone: '', facts: '' };
const role = (c: Pick<Contact, 'title' | 'company'>) => [c.title, c.company].filter(Boolean).join(' · ');

/**
 * Before a call: pick a saved contact (search as you type) or type someone new. The drawer holds the
 * how-it-works note (open the first time) and the call shortcuts.
 */
export function NewCall() {
  const seenHint = useStore(settingsStore, (s) => s.seenLiveHint);
  const all = useResource((signal) => getApi().contacts({ limit: 1 }, { signal }), []);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [typing, setTyping] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [save, setSave] = useState(true);
  const [nameError, setNameError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const none = all.data?.total === 0;
  const showTyped = typing || none;

  const set = (k: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    if (k === 'name') setNameError(undefined);
  };

  const pick = (c: Contact | null) => {
    setPicked(c);
    if (c) {
      setTyping(false);
      warmResearch(c.id);
    }
  };

  const callPicked = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await callContact(picked);
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not start the call', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (save && !f.name.trim()) {
      setNameError('Add a name to save them to contacts (or untick Save).');
      document.getElementById('new-call-name')?.focus();
      return;
    }
    if (!f.name.trim() && !f.company.trim()) {
      setNameError('Add a name or a company so Cue knows who you are calling.');
      document.getElementById('new-call-name')?.focus();
      return;
    }
    setBusy(true);
    const facts: Record<string, string> = f.facts.trim() ? { 'What you know': f.facts.trim() } : {};
    try {
      if (save) {
        const c = await getApi().createContact({
          name: f.name.trim(),
          title: f.title.trim(),
          company: f.company.trim(),
          ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
          facts,
          ...(settingsStore.get().repId ? { ownerRepId: settingsStore.get().repId } : {}),
        });
        await startCall({ source: 'cue', contactId: c.id, prospect: {}, rep: currentRep() });
      } else {
        const prospect: Prospect = { name: f.name.trim(), title: f.title.trim(), company: f.company.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), facts };
        await startCall({ source: 'cue', prospect, rep: currentRep() });
      }
      setF(EMPTY);
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not start the call', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const first = picked ? firstName(picked.name) || picked.name : '';

  return (
    <Workspace
      storageKey="live-new"
      className="web-newcall"
      drawer={{
        label: 'How Cue works',
        defaultOpen: !seenHint,
        summary: 'and shortcuts',
        children: <HowItWorks seen={seenHint} />,
      }}
    >
      <Pane
        paneId="new-call"
        label="New call"
        foldable={false}
        focusable={false}
        hint="Pick who you're calling. Cue reads up on them, then suggests what to say as the call goes."
        footer={
          picked && !showTyped ? (
            <ActionBar end={<span className="web-muted web-small">Only you speak. Cue suggests.</span>}>
              <Button variant="primary" icon="phone" loading={busy} onClick={() => void callPicked()}>
                {`Call ${first}`}
              </Button>
            </ActionBar>
          ) : showTyped ? (
            <ActionBar end={<span className="web-muted web-small">Only you speak. Cue suggests.</span>}>
              <Button type="submit" form="new-call-form" variant="primary" icon="phone" loading={busy}>
                Start call
              </Button>
            </ActionBar>
          ) : undefined
        }
      >
        <div className="web-newcall__body">
          <h1 className="web-start__title">Know exactly what to say next.</h1>
          {none ? (
            <div className="web-callout">
              <p className="web-callout__title">No saved contacts yet</p>
              <p className="web-muted web-small">Saved contacts fill in the call for you and let Cue research them before you dial. Add one, import your list, or type someone below.</p>
              <span className="web-chips">
                <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(true)}>
                  Add a contact
                </Button>
                <Button size="sm" variant="secondary" icon="upload" onClick={() => setImporting(true)}>
                  Import a CSV
                </Button>
              </span>
            </div>
          ) : (
            <>
              <ContactPicker value={picked} onChange={pick} disabled={busy} />
              {picked && <PickedCard contact={picked} onClear={() => pick(null)} />}
              {!typing && (
                <button type="button" className="web-linkbtn" aria-expanded={false} aria-controls="new-call-form" onClick={() => { setTyping(true); setPicked(null); }}>
                  Or type someone new
                </button>
              )}
            </>
          )}
          {showTyped && (
            <form id="new-call-form" className="web-stack web-typed" onSubmit={submit} aria-label="Someone new">
              {!none && (
                <div className="web-typed__head">
                  <span className="cue-label">Someone new</span>
                  <button type="button" className="web-linkbtn" aria-expanded aria-controls="new-call-form" onClick={() => setTyping(false)}>
                    Pick a saved contact instead
                  </button>
                </div>
              )}
              <div className="web-grid-2">
                <TextField id="new-call-name" label="Name" value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" error={nameError} />
                <TextField label="Title" optional value={f.title} onChange={set('title')} maxLength={200} autoComplete="off" />
                <TextField label="Company" optional value={f.company} onChange={set('company')} maxLength={200} autoComplete="off" />
                <TextField label="Phone" optional value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" autoComplete="off" />
              </div>
              <TextField label="What you know" optional hint="Funding, headcount, anything the brief should use." value={f.facts} onChange={set('facts')} maxLength={500} />
              <label className="web-check">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                <span>
                  Save to contacts
                  <span className="web-muted web-small web-check__sub">So next time you can just pick them, and their calls stay together.</span>
                </span>
              </label>
            </form>
          )}
        </div>
      </Pane>

      <ContactFormDialog
        open={adding}
        contact={null}
        onClose={() => setAdding(false)}
        onSaved={(c) => {
          setAdding(false);
          all.reload();
          pick(c);
        }}
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onImported={all.reload} />
    </Workspace>
  );
}

/** The drawer before a call: the three steps (with "Got it" the first time) and the call shortcuts. */
function HowItWorks({ seen }: { seen: boolean }) {
  const ws = useWorkspace();
  return (
    <Pane
      label="How Cue works"
      side="drawer"
      as="aside"
      pad="none"
      footer={
        seen ? undefined : (
          <ActionBar>
            <Button
              size="sm"
              variant="secondary"
              icon="check"
              onClick={() => {
                updateSettings({ seenLiveHint: true });
                ws?.toggleSide('drawer', false);
              }}
            >
              Got it
            </Button>
          </ActionBar>
        )
      }
    >
      <ol className="web-steps">
        <li>
          <b>Pick who you&rsquo;re calling.</b> Cue researches the person and company and writes a short brief with an opener.
        </li>
        <li>
          <b>Talk as usual.</b> Cue listens to what the prospect says, works out the moment (a brush-off, an objection, interest) and shows one line to say next.
        </li>
        <li>
          <b>Tap Used or Skip.</b> After the call, a 30-second debrief tells Cue what worked, so the suggestions get better for the whole team.
        </li>
      </ol>
      <PaneSection label="Shortcuts" meta="during a call">
        <ul className="web-keys" aria-label="Shortcuts during a call">
          <li><Kbd keys={[MOD, '.']} /> show the full suggestion</li>
          <li><Kbd keys={['U']} /> I used it</li>
          <li><Kbd keys={['D']} /> skip it</li>
          <li><Kbd keys={['E']} /> edit the line</li>
          <li><Kbd keys={['B']} /> meeting booked</li>
          <li><Kbd keys={['Space']} /> hold while you talk</li>
        </ul>
      </PaneSection>
    </Pane>
  );
}

function PickedCard({ contact, onClear }: { contact: Contact; onClear: () => void }) {
  const facts = Object.entries(contact.facts).slice(0, 3);
  return (
    <div className="web-picked" aria-live="polite">
      <div className="web-picked__head">
        <span className="web-picked__name">{contact.name}</span>
        <Button size="sm" variant="ghost" icon="close" onClick={onClear}>
          Change
        </Button>
      </div>
      <span className="web-muted web-small">{role(contact) || 'No title or company saved'}</span>
      <span className="web-small">
        {contact.lastCalledAt ? (
          <>
            {`Last called ${whenLabel(contact.lastCalledAt)}`}
            {contact.lastOutcome && (
              <>
                {' '}
                <Chip size="sm" tone={callStatus({ status: 'ended', outcome: contact.lastOutcome }).tone}>
                  {callStatus({ status: 'ended', outcome: contact.lastOutcome }).label}
                </Chip>
              </>
            )}
          </>
        ) : (
          'First call'
        )}
      </span>
      {facts.length > 0 && (
        <span className="web-muted web-small">{facts.map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
      )}
      <Hint>Cue has started researching them, so the brief is ready when you dial.</Hint>
    </div>
  );
}

/** A search-as-you-type combobox over saved contacts (ARIA 1.2 combobox + listbox, arrow keys and Enter). */
export function ContactPicker({ value, onChange, disabled }: { value: Contact | null; onChange: (c: Contact | null) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 150);
  const res = useResource((signal) => (open ? getApi().contacts({ q: q || undefined, limit: 8 }, { signal }) : Promise.resolve(null)), [q, open]);
  const items = res.data?.items ?? [];
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [q, res.data]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (c: Contact) => {
    onChange(c);
    setText('');
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && items[active]) {
        e.preventDefault();
        choose(items[active]!);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const expanded = open && (items.length > 0 || (res.data !== null && !res.loading));

  return (
    <div className="web-combo" ref={wrap}>
      <label className="cue-field__label" htmlFor={`${id}-input`}>
        {value ? 'Call someone else' : 'Pick a saved contact'}
      </label>
      <div className="web-combo__box">
        <input
          ref={input}
          id={`${id}-input`}
          className="web-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && items[active] ? `${id}-opt-${items[active]!.id}` : undefined}
          placeholder="Type a name or company"
          value={text}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </div>
      {expanded && (
        <ul className="web-combo__list" role="listbox" id={listId} aria-label="Matching contacts">
          {items.length === 0 ? (
            <li className="web-combo__none" role="presentation">
              {q ? `No saved contact matches “${q}”. Type them in as someone new below.` : 'No saved contacts.'}
            </li>
          ) : (
            items.map((c, i) => (
              <li
                key={c.id}
                id={`${id}-opt-${c.id}`}
                role="option"
                aria-selected={i === active}
                className={`web-combo__opt${i === active ? ' is-active' : ''}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                onPointerEnter={() => setActive(i)}
              >
                <span className="web-combo__name">{c.name}</span>
                <span className="web-muted web-small">{[role(c), c.lastCalledAt ? `last called ${whenLabel(c.lastCalledAt)}` : 'not called yet'].filter(Boolean).join(' · ')}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
