import { Button, Icon, TextField } from '@cue/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { request, type HealthSummary } from '../../src/messages';
import { serverOrigin } from '../../src/manifest';
import type { Settings } from '../../src/settings';

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

/**
 * The one thing the extension asks for itself: where the Cue server is, shown only when it can't
 * reach it (everything else is set in the Cue app). Like signing in: once, then out of the way.
 */
export function Connect({ settings, update, problem, onConnected }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; problem: string; onConnected: () => void }) {
  const [server, setServer] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setServer(settings.serverUrl), [settings.serverUrl]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const url = serverOrigin(server.trim());
    setBusy(true);
    setError(null);
    if (!(await ensureOrigin(url))) {
      setBusy(false);
      setError(`Chrome didn't allow Cue to reach ${url}.`);
      return;
    }
    await update({ serverUrl: url, token: token.trim() });
    const res = await request<HealthSummary>({ type: 'server.health' });
    setBusy(false);
    if (res.ok) onConnected();
    else setError(`Still can't reach it: ${res.error}`);
  };

  return (
    <main className="sp-main sp-connect">
      <div className="sp-connect__intro">
        <h1 className="sp-who__name">Connect Cue</h1>
        <p className="sp-quiet">{problem}</p>
      </div>
      <form className="sp-connect__form" onSubmit={submit} aria-label="Cue server">
        <TextField label="Cue server" value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} hint="Your team's Cue address. Ask whoever set Cue up." />
        <TextField label="Access token" type="password" value={token} onChange={(e) => setToken(e.target.value)} optional autoComplete="off" hint="Only if your server asks for one. Kept on this device." />
        {error && (
          <p className="sp-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Connect
        </Button>
      </form>
      <p className="sp-quiet">Your name, the look and when Cue starts are set in the Cue app, under Settings → Chrome extension.</p>
    </main>
  );
}
