import { OUTCOMES, OUTCOME_LABEL, type Outcome } from '@cue/core';
import { Button, Chip, IconButton, SegmentedControl, Switch, TextField } from '@cue/ui';
import { useState, type FormEvent } from 'react';
import { useResource } from '../hooks/useResource';
import { getApi } from '../state/api';
import { settingsStore, updateSettings, type Density, type Direction, type ThemePref, type TranscriberKind } from '../state/settings';
import { useStore } from '../state/store';
import { toast } from '../state/ui';

/** Server, look, capture and Trellus. Everything but the Trellus key stays in this browser. */
export function SettingsScreen() {
  const s = useStore(settingsStore);
  const [server, setServer] = useState(s.serverUrl);
  const [token, setToken] = useState(s.token);
  const health = useResource((signal) => getApi().health({ signal }), [s.serverUrl, s.token]);

  const saveServer = (e: FormEvent) => {
    e.preventDefault();
    updateSettings({ serverUrl: server.trim().replace(/\/+$/, ''), token: token.trim() });
    toast({ tone: 'ok', title: 'Server saved' });
  };

  return (
    <div className="web-screen web-page web-settings">
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">Settings</p>
          <h1 className="web-h1">Make Cue yours</h1>
        </div>
      </header>

      <form className="web-panel web-stack" onSubmit={saveServer} aria-labelledby="set-server">
        <div className="web-panel__head">
          <h2 className="web-h3" id="set-server">
            Server
          </h2>
          <Chip size="sm" tone={health.data?.ok ? 'ok' : health.loading ? 'neutral' : 'bad'} icon={health.data?.ok ? 'check' : health.loading ? 'dot' : 'wifi-off'}>
            {health.data?.ok ? `Connected · v${health.data.version}` : health.loading ? 'Checking…' : 'Not reachable'}
          </Chip>
        </div>
        <div className="web-grid-2">
          <TextField label="Server URL" value={server} onChange={(e) => setServer(e.target.value)} placeholder="Same origin" hint="Leave empty to use this site's /api (the dev server proxies it)." inputMode="url" autoComplete="off" />
          <TextField label="Access token" optional type="password" value={token} onChange={(e) => setToken(e.target.value)} hint="Sent as x-cue-token when the server asks for one." autoComplete="off" />
        </div>
        {health.data && (
          <p className="web-muted web-small">
            Mubit {health.data.mubit.configured ? 'on' : 'off (rules engine)'} · Sapling {health.data.sapling.configured ? 'on' : 'off'} · Exa {health.data.exa.configured ? 'on' : 'off'} ·{' '}
            {health.data.store.calls} calls stored
          </p>
        )}
        <div className="web-row web-row--end">
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>

      <section className="web-panel web-stack" aria-labelledby="set-look">
        <h2 className="web-h3" id="set-look">
          Look
        </h2>
        <SegmentedControl<Direction>
          label="Direction"
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
            label="Theme"
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={s.theme}
            onChange={(theme) => updateSettings({ theme })}
          />
          <SegmentedControl<Density>
            label="Density"
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            value={s.density}
            onChange={(density) => updateSettings({ density })}
          />
        </div>
        {s.direction === 'night' && <p className="web-muted web-small">Night Shift is always dark.</p>}
      </section>

      <section className="web-panel web-stack" aria-labelledby="set-capture">
        <h2 className="web-h3" id="set-capture">
          Calls
        </h2>
        <div className="web-grid-2">
          <TextField label="Your name" value={s.repName} onChange={(e) => updateSettings({ repName: e.target.value })} maxLength={120} />
          <SegmentedControl<TranscriberKind>
            label="Transcriber"
            options={[
              { value: 'webspeech', label: 'Browser speech' },
              { value: 'typed', label: 'Typed only' },
            ]}
            value={s.transcriber}
            onChange={(transcriber) => updateSettings({ transcriber })}
          />
        </div>
        <Switch label="Read the practice prospect aloud" description="Uses the browser's voice for the simulated prospect's lines." checked={s.practiceVoice} onCheckedChange={(practiceVoice) => updateSettings({ practiceVoice })} />
        <Switch label="Show how each card was made" description="Adds the write path, latency and Mubit request id to the card. Handy on stage." checked={s.debug} onCheckedChange={(debug) => updateSettings({ debug })} />
        <Switch label="Hands-free demo" description="Demo mode fills in the debrief and opens the playbook on its own." checked={s.demoHandsFree} onCheckedChange={(demoHandsFree) => updateSettings({ demoHandsFree })} />
        <SegmentedControl<string>
          label="Demo pace"
          options={[
            { value: '0.75', label: 'Relaxed' },
            { value: '1', label: 'Natural' },
            { value: '1.5', label: 'Brisk' },
            { value: '2.5', label: 'Rehearsal' },
          ]}
          value={String(s.demoSpeed)}
          onChange={(v) => updateSettings({ demoSpeed: Number(v) })}
        />
      </section>

      <Trellus />
    </div>
  );
}

function Trellus() {
  const status = useResource((signal) => getApi().trellusStatus({ signal }), []);
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
    <section className="web-panel web-stack" aria-labelledby="set-trellus">
      <div className="web-panel__head">
        <h2 className="web-h3" id="set-trellus">
          Trellus
        </h2>
        <Chip size="sm" tone={st?.configured ? (st.reachable === false ? 'bad' : 'ok') : 'neutral'}>
          {!st ? 'Checking…' : st.configured ? (st.reachable === false ? 'Not reachable' : 'Connected') : 'Trellus not connected'}
        </Chip>
      </div>
      <p className="web-muted web-small">
        Trellus keeps dialing. Cue reads outcomes from its Call Data API; the key is stored on the server and never comes back to the browser.
        {st?.lastSyncAt ? ` Last sync ${new Date(st.lastSyncAt).toLocaleString()}.` : ''}
        {st?.lastError ? ` Last error: ${st.lastError}` : ''}
      </p>
      <form className="web-grid-2" onSubmit={saveKey}>
        <TextField label="API key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder={st?.configured ? 'Saved. Paste to replace.' : ''} />
        <TextField label="Team id" optional value={team} onChange={(e) => setTeam(e.target.value)} autoComplete="off" />
        <div className="web-row">
          <Button type="submit" variant="primary" loading={busy === 'key'} disabled={!key.trim()}>
            Save key
          </Button>
          <Button variant="secondary" icon="refresh" loading={busy === 'sync'} onClick={() => void sync()}>
            Sync now
          </Button>
        </div>
      </form>

      <Dispositions />
    </section>
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
    <div className="web-stack web-dispo">
      <div className="web-panel__head">
        <h3 className="web-h4">Disposition map</h3>
        {d && (
          <Chip size="sm" tone={d.unmapped.length ? 'warn' : 'ok'}>
            {d.unmapped.length ? `${d.unmapped.length} not mapped` : `${d.source === 'trellus' ? 'Trellus' : 'Cue native'} vocabulary`}
          </Chip>
        )}
      </div>
      <p className="web-muted web-small">How each disposition counts when Cue reads a call's outcome. Your changes are saved on the server.{d?.error ? ` ${d.error}` : ''}</p>
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
                <span className="web-dispo__key web-trunc" title={raw}>
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
        <TextField label="Another disposition" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Demo set" />
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
      <div className="web-row web-row--end">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        )}
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save map
        </Button>
      </div>
    </div>
  );
}
