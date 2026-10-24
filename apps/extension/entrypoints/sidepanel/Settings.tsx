import { Button, Chip, SegmentedControl, Switch, TextField } from '@cue/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { HOSTS } from '../../src/hosts';
import { request, type HealthSummary, type TrellusStatus } from '../../src/messages';
import { serverOrigin } from '../../src/manifest';
import type { Direction, Settings, ThemePref } from '../../src/settings';
import { DispositionsEditor } from './Dispositions';

type Check = { state: 'idle' | 'checking' } | { state: 'ok'; health: HealthSummary } | { state: 'bad'; message: string };

/** Asks Chrome for the server's origin when it isn't one the manifest already covers. Must run in a click. */
async function ensureOrigin(url: string): Promise<boolean> {
  const origin = `${serverOrigin(url)}/*`;
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export function SettingsScreen({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [server, setServer] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [name, setName] = useState(settings.rep.name);

  useEffect(() => setServer(settings.serverUrl), [settings.serverUrl]);

  const saveServer = async (e: FormEvent) => {
    e.preventDefault();
    const url = serverOrigin(server.trim());
    setCheck({ state: 'checking' });
    if (!(await ensureOrigin(url))) {
      setCheck({ state: 'bad', message: `Chrome didn't allow Cue to reach ${url}.` });
      return;
    }
    await update({ serverUrl: url, token: token.trim() });
    const res = await request<HealthSummary>({ type: 'server.health' });
    setCheck(res.ok ? { state: 'ok', health: res.data } : { state: 'bad', message: res.error });
  };

  return (
    <div className="sp-settings">
      <form className="sp-section" onSubmit={saveServer} aria-labelledby="set-server">
        <h2 id="set-server" className="sp-label">
          Cue server
        </h2>
        <TextField label="Server URL" value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} />
        <TextField label="Access token" type="password" value={token} onChange={(e) => setToken(e.target.value)} optional autoComplete="off" hint="The server's CUE_API_TOKEN. Kept on this device only." />
        <div className="sp-row">
          <Button type="submit" variant="secondary" loading={check.state === 'checking'}>
            Save and test
          </Button>
          {check.state === 'ok' && (
            <Chip tone="ok" icon="check" size="sm">
              Connected{check.health.mubit ? ' · Mubit on' : ' · rules only'}
            </Chip>
          )}
        </div>
        {check.state === 'bad' && (
          <p className="sp-banner" role="alert">
            {check.message}
          </p>
        )}
      </form>

      <TrellusSection />

      <section className="sp-section" aria-labelledby="set-you">
        <h2 id="set-you" className="sp-label">
          You
        </h2>
        <TextField
          label="Your name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          // storage.sync has a write quota, so save on blur rather than per keystroke
          onBlur={() => name !== settings.rep.name && void update({ rep: { ...settings.rep, name: name.trim() } })}
          hint="Shown to your team on the playbook."
        />
      </section>

      <section className="sp-section" aria-labelledby="set-overbar">
        <h2 id="set-overbar" className="sp-label">
          On the dialer page
        </h2>
        <Switch label="Show the overbar" description="Alt+Shift+C shows or hides it." checked={settings.overlay} onCheckedChange={(overlay) => void update({ overlay })} />
        <Switch label="Start Cue when Trellus connects" description="Otherwise Cue offers a Start button." checked={settings.autoStart} onCheckedChange={(autoStart) => void update({ autoStart })} />
        <div className="sp-hosts" role="group" aria-label="Sites">
          {HOSTS.map((h) => (
            <Switch key={h.id} label={h.label} checked={settings.hosts[h.id]} onCheckedChange={(on) => void update({ hosts: { ...settings.hosts, [h.id]: on } })} />
          ))}
        </div>
      </section>

      <section className="sp-section" aria-labelledby="set-look">
        <h2 id="set-look" className="sp-label">
          Side panel look
        </h2>
        <SegmentedControl<Direction>
          label="Direction"
          value={settings.direction}
          onChange={(direction) => void update({ direction })}
          options={[
            { value: 'honey', label: 'Honey' },
            { value: 'night', label: 'Night' },
            { value: 'signal', label: 'Signal' },
          ]}
        />
        <SegmentedControl<ThemePref>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => void update({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </section>
    </div>
  );
}

/** The Trellus key goes straight to the server and is never kept in the extension. */
function TrellusSection() {
  const [status, setStatus] = useState<TrellusStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [team, setTeam] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void request<TrellusStatus>({ type: 'trellus.status' }).then((r) => (r.ok ? setStatus(r.data) : setError(r.error)));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    const r = await request<TrellusStatus>({ type: 'trellus.setKey', apiKey: key.trim(), ...(team.trim() ? { teamId: team.trim() } : {}) });
    setSaving(false);
    setKey(''); // never linger in memory longer than the request
    if (r.ok) {
      setStatus(r.data);
      setError(null);
    } else setError(r.error);
  };

  const connected = status?.configured && status.source === 'trellus';
  return (
    <>
    <form className="sp-section" onSubmit={save} aria-labelledby="set-trellus">
      <h2 id="set-trellus" className="sp-label">
        Trellus
      </h2>
      <div className="sp-row">
        <Chip size="sm" tone={connected ? (status?.reachable === false ? 'warn' : 'ok') : 'neutral'} icon={connected ? 'check' : 'info'}>
          {connected ? (status?.reachable === false ? 'Connected, not reachable' : 'Connected') : 'Trellus not connected'}
        </Chip>
        {status?.lastSyncAt && <span className="sp-hint">Last sync {new Date(status.lastSyncAt).toLocaleTimeString()}</span>}
      </div>
      {status?.lastError && <p className="sp-hint">{status.lastError}</p>}
      <TextField
        label="Trellus API key"
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="off"
        optional
        hint="Trellus → Settings → Integrations → API. Sent to your Cue server once; never stored in the extension."
      />
      <TextField label="Team id" value={team} onChange={(e) => setTeam(e.target.value)} optional autoComplete="off" />
      <div className="sp-row">
        <Button type="submit" variant="secondary" loading={saving} disabled={!key.trim()}>
          {connected ? 'Replace key' : 'Connect Trellus'}
        </Button>
      </div>
      {error && (
        <p className="sp-banner" role="alert">
          {error}
        </p>
      )}
    </form>
    <section className="sp-section" aria-label="Trellus dispositions">
      <DispositionsEditor />
    </section>
    </>
  );
}
