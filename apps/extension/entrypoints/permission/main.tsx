import '@cue/ui/styles.css';
import '../sidepanel/sidepanel.css';
import { Button, CueRoot, EmptyState, FONT_HREF, Sprout } from '@cue/ui';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

/** A full tab can always show Chrome's permission prompt; the grant then covers the offscreen capture. */
function Permission() {
  const [state, setState] = useState<'idle' | 'granted' | 'denied'>('idle');
  const ask = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of s.getTracks()) t.stop();
      setState('granted');
      setTimeout(() => window.close(), 1200);
    } catch {
      setState('denied');
    }
  };
  return (
    <CueRoot direction="honey" className="sp-root sp-root--page">
      <main className="sp-main sp-main--center">
        <EmptyState
          art={<Sprout state={state === 'granted' ? 'celebrating' : state === 'denied' ? 'warning' : 'listening'} size={96} />}
          title={state === 'granted' ? 'Microphone allowed' : 'Let Cue hear your side of the call'}
          action={
            state === 'granted' ? undefined : (
              <Button variant="primary" icon="mic" onClick={() => void ask()}>
                Allow microphone
              </Button>
            )
          }
        >
          {state === 'denied'
            ? 'Chrome blocked it. Click the icon at the end of the address bar, allow the microphone, then try again.'
            : state === 'granted'
              ? 'You can close this tab. Cue will use the mic on your next call.'
              : 'Cue turns what you say into text, so it can tell which of its lines you used.'}
        </EmptyState>
      </main>
    </CueRoot>
  );
}

const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = FONT_HREF;
document.head.append(fonts);
createRoot(document.getElementById('root')!).render(<Permission />);
