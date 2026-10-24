import { ActionBar, Button, Chip, Icon, KeyValue, Pane, SegmentedControl, Switch, TextField } from '@cue/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { HOSTS } from '../../src/hosts';
import { request, type HealthSummary, type TrellusStatus } from '../../src/messages';
import { serverOrigin } from '../../src/manifest';
import { webAppUrl, type Direction, type Settings, type ThemePref } from '../../src/settings';

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
  const [web, setWeb] = useState(settings.webUrl);

  useEffect(() => setServer(settings.serverUrl), [settings.serverUrl]);
  useEffect(() => setWeb(settings.webUrl), [settings.webUrl]);

  // Show where things stand as soon as the pane opens, without saving anything.
  useEffect(() => {
    let live = true;
    void request<HealthSummary>({ type: 'server.health' }).then((res) => {
      if (live) setCheck((c) => (c.state === 'idle' ? (res.ok ? { state: 'ok', health: res.data } : { state: 'bad', message: `Can't reach the Cue server at ${settings.serverUrl}: ${res.error}` }) : c));
    });
    return () => {
      live = false;
    };
  }, [settings.serverUrl]);

  const saveServer = async (e: FormEvent) => {
    e.preventDefault();
    const url = serverOrigin(server.trim());
    setCheck({ state: 'checking' });
    if (!(await ensureOrigin(url))) {
      setCheck({ state: 'bad', message: `Chrome didn't allow Cue to reach ${url}.` });
      return;
    }
    await update({ serverUrl: url, token: token.trim(), webUrl: web.trim() });
    const res = await request<HealthSummary>({ type: 'server.health' });
    setCheck(res.ok ? { state: 'ok', health: res.data } : { state: 'bad', message: res.error });
  };

  return (
    <div className="sp-settings">
      <form className="sp-form" onSubmit={saveServer} aria-label="Cue server">
        <Pane
          label="Cue server"
          meta={check.state === 'ok' ? 'connected' : undefined}
          scroll={false}
          footer={
            <ActionBar>
              <Button type="submit" variant="primary" loading={check.state === 'checking'}>
                Save and test
              </Button>
            </ActionBar>
          }
        >
          <div className="sp-stack">
            <TextField label="Server URL" value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} />
            <TextField label="Access token" type="password" value={token} onChange={(e) => setToken(e.target.value)} optional autoComplete="off" hint="Only if your Cue server asks for one. Kept on this device only." />
            <TextField
              label="Cue app address"
              value={web}
              onChange={(e) => setWeb(e.target.value)}
              optional
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={webAppUrl({ serverUrl: settings.serverUrl, webUrl: '' })}
              hint="Where “Open in Cue” links go (past calls, contacts, team). Leave empty to use the one beside your server."
            />
            {check.state === 'ok' && (
              <KeyValue
                items={[
                  { label: 'Server', value: <Chip size="sm" tone="ok" icon="check">Connected</Chip> },
                  { label: 'Suggestions', value: check.health.mubit ? 'Tailored by your trained model (Mubit)' : 'Playbook lines only (no Mubit key on the server)' },
                  { label: 'Trellus', value: check.health.trellus ? 'Connected on the server' : 'Not connected' },
                ]}
              />
            )}
            {check.state === 'bad' && (
              <p className="sp-banner" role="alert">
                {check.message}
              </p>
            )}
          </div>
        </Pane>
      </form>

      <TrellusSection />

      <Pane label="You" scroll={false}>
        <TextField
          label="Your name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          // storage.sync has a write quota, so save on blur rather than per keystroke
          onBlur={() => name !== settings.rep.name && void update({ rep: { ...settings.rep, name: name.trim() } })}
          hint="Shown on your calls in the Cue app."
        />
      </Pane>

      <Pane label="On the dialer page" scroll={false}>
        <div className="sp-stack">
          <Switch label="Show the overbar" description="Alt+Shift+C shows or hides it." checked={settings.overlay} onCheckedChange={(overlay) => void update({ overlay })} />
          <Switch label="Start Cue when Trellus connects" description="Otherwise Cue offers a Start button." checked={settings.autoStart} onCheckedChange={(autoStart) => void update({ autoStart })} />
          <div className="sp-hosts" role="group" aria-label="Sites">
            {HOSTS.map((h) => (
              <Switch key={h.id} label={h.label} checked={settings.hosts[h.id]} onCheckedChange={(on) => void update({ hosts: { ...settings.hosts, [h.id]: on } })} />
            ))}
          </div>
        </div>
      </Pane>

      <Pane label="Look" meta="side panel and overbar" scroll={false}>
        <div className="sp-stack">
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
        </div>
      </Pane>
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
    <form className="sp-form" onSubmit={save} aria-label="Trellus">
      <Pane
        label="Trellus"
        meta={status?.lastSyncAt ? `synced ${new Date(status.lastSyncAt).toLocaleTimeString()}` : undefined}
        actions={
          <Chip size="sm" tone={connected ? (status?.reachable === false ? 'warn' : 'ok') : 'neutral'} icon={connected ? 'check' : 'info'}>
            {connected ? (status?.reachable === false ? 'Connected, not reachable' : 'Connected') : 'Trellus not connected'}
          </Chip>
        }
        scroll={false}
        footer={
          <ActionBar>
            <Button type="submit" variant="secondary" loading={saving} disabled={!key.trim()}>
              {connected ? 'Replace key' : 'Connect Trellus'}
            </Button>
          </ActionBar>
        }
      >
        <div className="sp-stack">
          {status?.lastError && (
            <p className="sp-note sp-note--warn">
              <Icon name="alert" size={14} />
              {status.lastError}
            </p>
          )}
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
          {error && (
            <p className="sp-banner" role="alert">
              {error}
            </p>
          )}
        </div>
      </Pane>
    </form>
  );
}
