import { OUTCOMES, OUTCOME_LABEL, type Outcome, type TrellusStatusResponse } from '@cue/core';
import { ActionBar, Button, Chip, Hint, IconButton, KeyValue, Pane, PaneSection, SegmentedControl, Switch, TextField, Workspace } from '@cue/ui';
import { useState, type FormEvent } from 'react';
import { useResource, type Resource } from '../hooks/useResource';
import { getApi } from '../state/api';
import { repIdFor, settingsStore, updateSettings, type Density, type Direction, type ThemePref, type TranscriberKind } from '../state/settings';
import { EXTENSION_HOSTS, extensionStore, updateExtension, type ExtensionState } from '../state/extension';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import '../styles/screens/settings.css';

type Section = 'you' | 'listening' | 'extension' | 'trellus' | 'data';

const SECTIONS: { id: Section; label: string; note: string }[] = [
  { id: 'you', label: 'You and appearance', note: 'Your name, the look, light or dark' },
  { id: 'listening', label: 'Listening', note: 'How Cue hears the call' },
  { id: 'extension', label: 'Chrome extension', note: 'Cue beside HubSpot and Trellus' },
  { id: 'trellus', label: 'Trellus', note: 'The dialer and its outcomes' },
  { id: 'data', label: 'Data and privacy', note: 'Server, add-ons, export' },
];

/**
 * You, the look, capture, server and Trellus, as one pane with a tab per section; the rail lists the
 * sections with their state. Everything but the Trellus key and disposition map stays in this browser.
 */
export function SettingsScreen() {
  const s = useStore(settingsStore);
  const [section, setSection] = useState<Section>('you');
  const [server, setServer] = useState(s.serverUrl);
  const [token, setToken] = useState(s.token);
  const health = useResource((signal) => getApi().health({ signal }), [s.serverUrl, s.token]);
  const team = useResource((signal) => getApi().team({}, { signal }), [s.serverUrl, s.token]);
  const trellus = useResource((signal) => getApi().trellusStatus({ signal }), []);
  const ext = useStore(extensionStore);
  const members = team.data?.members ?? [];
  const st = trellus.data;

  const saveServer = (e: FormEvent) => {
    e.preventDefault();
    updateSettings({ serverUrl: server.trim().replace(/\/+$/, ''), token: token.trim() });
    toast({ tone: 'ok', title: 'Server saved' });
  };

  const healthChip = (
    <Chip size="sm" tone={health.data?.ok ? 'ok' : health.loading ? 'neutral' : 'bad'} icon={health.data?.ok ? 'check' : health.loading ? 'dot' : 'wifi-off'}>
      {health.data?.ok ? `Connected · v${health.data.version}` : health.loading ? 'Checking…' : 'Not reachable'}
    </Chip>
  );
  const trellusChip = (
    <Chip size="sm" tone={st?.configured ? (st.reachable === false ? 'bad' : 'ok') : 'neutral'}>
      {!st ? 'Checking…' : st.configured ? (st.reachable === false ? 'Not reachable' : 'Connected') : 'Not connected'}
    </Chip>
  );
  const state: Record<Section, string> = {
    you: s.repName ? firstWord(s.repName) : 'no name',
    listening: s.transcriber === 'webspeech' ? 'mic' : 'typed',
    extension: ext.version ? 'on' : 'not found',
    trellus: !st ? '…' : st.configured ? (st.reachable === false ? 'down' : 'on') : 'off',
    data: health.data?.ok ? 'online' : health.loading ? '…' : 'offline',
  };
  const current = SECTIONS.find((x) => x.id === section)!;

  return (
    <div className="web-screen">
      <h1 className="web-sr">Make Cue yours</h1>
      <Workspace
        storageKey="settings"
        rail={{
          label: 'Sections',
          width: 'minmax(260px, 19vw)',
          summary: current.label.toLowerCase(),
          children: (
            <Pane label="Sections" side="rail" pad="none" as="nav">
              <ul className="cue-index web-set-index">
                {SECTIONS.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="cue-index__item" aria-current={section === x.id ? 'true' : undefined} onClick={() => setSection(x.id)}>
                      <span className="cue-index__key" aria-hidden />
                      <span className="cue-index__name">{x.label}</span>
                      <span className="cue-index__fig">{state[x.id]}</span>
                      <span className="cue-index__sub">{x.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="cue-hint web-pad web-pad--tight">Everything here stays in this browser, except the Trellus key and the disposition map, which live on the server.</p>
            </Pane>
          ),
        }}
      >
        <Pane
          paneId="settings"
          label="Settings"
          foldable={false}
          focusable={false}
          pad="none"
          tabs={SECTIONS.map((x) => ({ id: x.id, label: x.label }))}
          tab={section}
          onTab={(t) => setSection(t as Section)}
          actions={section === 'trellus' ? trellusChip : section === 'data' ? healthChip : undefined}
          footer={
            section === 'data' ? (
              <ActionBar end={<a className="cue-btn cue-btn--ghost cue-btn--md" href={getApi().exportUrl()} download>Export calls (JSONL)</a>}>
                <Button type="submit" form="set-server" variant="primary">
                  Save
                </Button>
              </ActionBar>
            ) : undefined
          }
        >
          {section === 'you' ? (
            <div className="web-set-body" aria-label="You and appearance">
              <Hint>Your name marks the calls you make, so Team can show your own numbers.</Hint>
              <TextField
                label="Your name"
                value={s.repName}
                onChange={(e) => updateSettings({ repName: e.target.value, repId: repIdFor(e.target.value) })}
                maxLength={120}
                autoComplete="name"
                hint={s.repId ? undefined : 'Add your name to see your own numbers on Team.'}
                id="settings-rep-name"
              />
              {members.length > 0 && (
                <label className="web-select">
                  <span className="cue-field__label">Or pick yourself from the team</span>
                  <select
                    className="web-input"
                    value={members.some((m) => m.rep.id === s.repId) ? s.repId : ''}
                    onChange={(e) => {
                      const m = members.find((x) => x.rep.id === e.target.value);
                      if (m) updateSettings({ repId: m.rep.id, repName: m.rep.name });
                    }}
                  >
                    <option value="">Someone new</option>
                    {members.map((m) => (
                      <option key={m.rep.id} value={m.rep.id}>
                        {m.rep.name || m.rep.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <SegmentedControl<Direction>
                label="Look"
                showLabel
                options={[
                  { value: 'honey', label: 'Honey' },
                  { value: 'night', label: 'Night Shift' },
                  { value: 'signal', label: 'Signal' },
                ]}
                value={s.direction}
                onChange={(direction) => updateSettings({ direction })}
              />
              <div className="web-grid-2">
                <SegmentedControl<ThemePref>
                  label="Light or dark"
                  showLabel
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  value={s.theme}
                  onChange={(theme) => updateSettings({ theme })}
                />
                <SegmentedControl<Density>
                  label="Spacing"
                  showLabel
                  options={[
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                  value={s.density}
                  onChange={(density) => updateSettings({ density })}
                />
              </div>
              {s.direction === 'night' && <p className="web-muted web-small">Night Shift is always dark.</p>}
            </div>
          ) : section === 'listening' ? (
            <div className="web-set-body" aria-label="Listening">
              <Hint>Browser speech uses your mic; typed only means you enter what was said.</Hint>
              <SegmentedControl<TranscriberKind>
                label="Transcriber"
                showLabel
                options={[
                  { value: 'webspeech', label: 'Browser speech' },
                  { value: 'typed', label: 'Typed only' },
                ]}
                value={s.transcriber}
                onChange={(transcriber) => updateSettings({ transcriber })}
              />
              <Switch label="Show how each line was made" description="Adds who wrote it (Mubit or the playbook rules), how long it took and the Mubit request id under each line." checked={s.debug} onCheckedChange={(debug) => updateSettings({ debug })} />
              <Switch label="Show the Live tips again" description="The short how-it-works note on the Live screen." checked={!s.seenLiveHint} onCheckedChange={(on) => updateSettings({ seenLiveHint: !on })} />
            </div>
          ) : section === 'extension' ? (
            <ExtensionSettings ext={ext} />
          ) : section === 'trellus' ? (
            <Trellus status={trellus} />
          ) : (
            <form id="set-server" className="web-set-body" onSubmit={saveServer} aria-label="Server">
              <Hint>Which server Cue talks to and which add-ons it has switched on. Provider keys never reach the browser.</Hint>
              <div className="web-grid-2">
                <TextField label="Server URL" value={server} onChange={(e) => setServer(e.target.value)} placeholder="Same origin" hint="Leave empty to use this site's /api (the dev server proxies it)." inputMode="url" autoComplete="off" />
                <TextField label="Access token" optional type="password" value={token} onChange={(e) => setToken(e.target.value)} hint="Sent as x-cue-token when the server asks for one." autoComplete="off" />
              </div>
              {health.data && (
                <KeyValue
                  items={[
                    { label: 'Mubit (AI)', value: health.data.mubit.configured ? 'On' : 'Off: lines come straight from the playbook' },
                    { label: 'Sapling (tone)', value: health.data.sapling.configured ? 'On' : 'Off' },
                    { label: 'Exa (web research)', value: health.data.exa.configured ? 'On' : 'Off' },
                    ...(health.data.valyu ? [{ label: 'Valyu (web research)', value: health.data.valyu.configured ? 'On' : 'Off' }] : []),
                    { label: 'Calls stored', value: <span className="cue-num">{health.data.store.calls}</span> },
                  ]}
                />
              )}
            </form>
          )}
        </Pane>
      </Workspace>
    </div>
  );
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function Trellus({ status }: { status: Resource<TrellusStatusResponse> }) {
  const [key, setKey] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState<'key' | 'sync' | null>(null);
  const st = status.data;

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy('key');
    try {
      await getApi().setTrellusKey({ apiKey: key.trim(), ...(team.trim() ? { teamId: team.trim() } : {}) });
      setKey('');
      status.reload();
      toast({ tone: 'ok', title: 'Trellus key saved on the server' });
    } catch (err) {
      toast({ tone: 'bad', title: 'Trellus key not saved', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const r = await getApi().trellusSync();
      toast({ tone: 'ok', title: `Synced from ${r.source === 'trellus' ? 'Trellus' : 'native calls'}`, description: `${r.imported} imported · ${r.matched} matched · ${r.skipped} skipped` });
      status.reload();
    } catch (err) {
      toast({ tone: 'bad', title: 'Sync failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div aria-label="Trellus" className="web-set-sections">
      <p className="cue-hint web-pad web-pad--tight">Trellus is the dialer. Connect it and Cue picks up each call&rsquo;s outcome on its own.</p>
      <PaneSection label="Connection">
        <div className="web-stack">
          <p className="web-muted web-small">
            Trellus keeps dialing. Cue reads outcomes from its Call Data API; the key is stored on the server and never comes back to the browser.
            {st?.lastSyncAt ? ` Last sync ${new Date(st.lastSyncAt).toLocaleString()}.` : ''}
            {st?.lastError ? ` Last error: ${st.lastError}` : ''}
          </p>
          <form className="web-stack" onSubmit={saveKey}>
            <div className="web-grid-2">
              <TextField label="API key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder={st?.configured ? 'Saved. Paste to replace.' : ''} />
              <TextField label="Team id" optional value={team} onChange={(e) => setTeam(e.target.value)} autoComplete="off" />
            </div>
            <ActionBar>
              <Button type="submit" variant="primary" loading={busy === 'key'} disabled={!key.trim()}>
                Save key
              </Button>
              <Button variant="secondary" icon="refresh" loading={busy === 'sync'} onClick={() => void sync()}>
                Sync now
              </Button>
            </ActionBar>
          </form>
        </div>
      </PaneSection>
      <Dispositions />
    </div>
  );
}

const VIA_LABEL = { default: 'default', keyword: 'guessed', override: 'yours', unmapped: 'not mapped' } as const;

/** How each Trellus disposition counts as an outcome. Stored on the server, so the poller uses it. */
function Dispositions() {
  const res = useResource((signal) => getApi().trellusDispositions({ signal }), []);
  const [draft, setDraft] = useState<Record<string, Outcome> | null>(null);
  const [label, setLabel] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('meeting_booked');
  const [saving, setSaving] = useState(false);
  const d = res.data;
  const overrides = draft ?? d?.overrides ?? {};
  const dirty = draft !== null;

  const save = async () => {
    setSaving(true);
    try {
      await getApi().setTrellusDispositions({ overrides });
      setDraft(null);
      res.reload();
      toast({ tone: 'ok', title: 'Disposition map saved' });
    } catch (err) {
      toast({ tone: 'bad', title: 'Map not saved', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };
  const set = (raw: string, o: Outcome | null) => {
    const next = { ...overrides };
    if (o) next[raw] = o;
    else delete next[raw];
    setDraft(next);
  };

  return (
    <PaneSection
      label="Disposition map"
      hint="Trellus labels each call (a disposition). Pick which Cue outcome each label counts as."
      actions={
        d && (
          <Chip size="sm" tone={d.unmapped.length ? 'warn' : 'ok'}>
            {d.unmapped.length ? `${d.unmapped.length} not mapped` : `${d.source === 'trellus' ? 'Trellus' : 'Cue native'} vocabulary`}
          </Chip>
        )
      }
    >
    <div className="web-stack">
      {d?.error && <p className="web-muted web-small">{d.error}</p>}
      {res.error && !d ? (
        <p className="web-note web-note--warn">Can't load the map: {res.error.message}</p>
      ) : !d ? null : (
        <ul className="web-dispo__list">
          {[...new Set([...d.learned.map((l) => l.raw), ...Object.keys(overrides)])].map((raw) => {
            const learned = d.learned.find((l) => l.raw === raw);
            const value = overrides[raw] ?? learned?.outcome ?? 'unknown';
            const via = overrides[raw] ? 'override' : learned?.via ?? 'override';
            return (
              <li key={raw} className={`web-dispo__row${via === 'unmapped' ? ' is-unmapped' : ''}`}>
                <span className="web-dispo__key">
                  {raw}
                </span>
                <span className="web-muted web-small">{VIA_LABEL[via]}</span>
                <label className="web-sr" htmlFor={`dispo-${raw}`}>
                  {raw} counts as
                </label>
                <select id={`dispo-${raw}`} className="web-input web-input--sm" value={value} onChange={(e) => set(raw, e.target.value as Outcome)}>
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {OUTCOME_LABEL[o]}
                    </option>
                  ))}
                </select>
                {overrides[raw] ? <IconButton icon="close" label={`Reset ${raw}`} size="sm" onClick={() => set(raw, null)} /> : <span aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="web-dispo__add"
        onSubmit={(e) => {
          e.preventDefault();
          const k = label.trim();
          if (!k) return;
          set(k, outcome);
          setLabel('');
        }}
      >
        <TextField label="Another disposition" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Meeting set" />
        <label className="web-select">
          <span className="cue-field__label">Counts as</span>
          <select className="web-input" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" icon="plus" disabled={!label.trim()}>
          Add
        </Button>
      </form>
      <ActionBar
        end={
          dirty && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )
        }
      >
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save map
        </Button>
      </ActionBar>
    </div>
    </PaneSection>
  );
}

/**
 * How the Chrome extension behaves. It has no settings screen of its own: these switches reach it
 * through its bridge on this page. Your name and the look above follow by themselves.
 */
function ExtensionSettings({ ext }: { ext: ExtensionState }) {
  const e = ext.settings;
  if (!ext.version || !e)
    return (
      <div className="web-set-body" aria-label="Chrome extension">
        <Hint>The Cue extension sits beside HubSpot and Trellus: the brief while Trellus dials, the line to say and the transcript on the call, and the outcome after it.</Hint>
        <p className="web-muted web-small">
          It isn't installed in this browser, or this page loaded before it. Build it with <code>pnpm build:ext</code>, load <code>apps/extension/.output/chrome-mv3</code> at <code>chrome://extensions</code> (Developer mode, Load unpacked), then reload this page.
        </p>
      </div>
    );
  return (
    <div className="web-set-body" aria-label="Chrome extension">
      <Hint>The extension never asks for anything on the call. What it does is set here, and your name and the look follow the section above.</Hint>
      <KeyValue
        items={[
          { label: 'Extension', value: <Chip size="sm" tone="ok" icon="check">{`Connected · v${ext.version}`}</Chip> },
          { label: 'Its server', value: <span className="cue-num">{e.serverUrl}</span> },
          { label: 'Calls as', value: e.rep.name || 'No name yet' },
        ]}
      />
      <Switch label="Start by itself when Trellus connects" description="Otherwise the bar on the page offers a Start button." checked={e.autoStart} onCheckedChange={(autoStart) => updateExtension({ autoStart })} />
      <Switch label="Show the bar on the page" description="The one-line bar over HubSpot. Alt+Shift+C shows or hides it from the keyboard." checked={e.overlay} onCheckedChange={(overlay) => updateExtension({ overlay })} />
      <fieldset className="web-fieldset">
        <legend className="cue-field__label">Where the bar shows</legend>
        {EXTENSION_HOSTS.map((h) => (
          <Switch key={h.id} label={h.label} checked={e.hosts[h.id] ?? true} onCheckedChange={(on) => updateExtension({ hosts: { ...e.hosts, [h.id]: on } })} />
        ))}
      </fieldset>
    </div>
  );
}
