import { Button } from '@cue/ui';
import { useEffect, useState } from 'react';

type Perm = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * The offscreen document can't show a permission prompt, so the mic is granted to the extension
 * here (a visible page) once; the grant then covers capture. Falls back to a tab when the side
 * panel can't prompt.
 */
export function MicPermission({ compact }: { compact?: boolean }) {
  const [perm, setPerm] = useState<Perm>('unknown');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const onChange = () => status && setPerm(status.state as Perm);
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s;
        setPerm(s.state as Perm);
        s.addEventListener('change', onChange);
      })
      .catch(() => setPerm('unknown'));
    return () => status?.removeEventListener('change', onChange);
  }, []);

  if (perm === 'granted') return null;

  const ask = async () => {
    setAsking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setPerm('granted');
    } catch {
      // The side panel couldn't prompt (or it was dismissed): a full tab always can.
      await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className={compact ? 'sp-mic sp-mic--compact' : 'sp-mic'}>
      {!compact && <p className="sp-hint">Cue hears your side through the microphone. Chrome asks once.</p>}
      <Button size="sm" variant="secondary" icon="mic" loading={asking} onClick={() => void ask()}>
        {perm === 'denied' ? 'Unblock microphone' : 'Allow microphone'}
      </Button>
    </div>
  );
}
