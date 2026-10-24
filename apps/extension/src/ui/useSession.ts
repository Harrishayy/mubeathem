import { useEffect, useState } from 'react';
import { initialState, UI_PORT, type Broadcast, type Levels, type SessionState } from '../messages';

export interface SessionHook {
  state: SessionState;
  levels: Levels;
  /** False until the background has answered once (and while the port is reconnecting). */
  connected: boolean;
  overlayVisible: boolean | null;
}

/**
 * The background's SessionState over a long-lived port. The port reconnects when the service
 * worker restarts, and pings every 20 s so the worker stays awake during a call.
 */
export function useSession(): SessionHook {
  const [state, setState] = useState<SessionState>(initialState);
  const [levels, setLevels] = useState<Levels>({ prospect: 0, rep: 0 });
  const [connected, setConnected] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState<boolean | null>(null);

  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (disposed) return;
      try {
        port = chrome.runtime.connect({ name: UI_PORT });
      } catch {
        // Extension reloaded under us (content script orphaned): stop quietly.
        setConnected(false);
        return;
      }
      port.onMessage.addListener((b: Broadcast) => {
        if (b.type === 'state') {
          setState(b.state);
          setConnected(true);
        } else if (b.type === 'levels') setLevels(b.levels);
        else if (b.type === 'overlay.toggle') setOverlayVisible(b.visible);
      });
      port.onDisconnect.addListener(() => {
        port = null;
        setConnected(false);
        if (!disposed && chrome.runtime?.id) retry = setTimeout(connect, 500);
      });
    };

    connect();
    ping = setInterval(() => {
      try {
        port?.postMessage({ type: 'ping' });
      } catch {
        /* reconnect handles it */
      }
    }, 20_000);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      port?.disconnect();
    };
  }, []);

  return { state, levels, connected, overlayVisible };
}
