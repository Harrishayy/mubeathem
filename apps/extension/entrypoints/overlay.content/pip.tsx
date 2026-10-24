import type { SuggestionAction } from '@cue/core';
import { CueRoot, FONT_HREF, Overbar, type OverbarMode } from '@cue/ui';
import { useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { request } from '../../src/messages';
import { useSession } from '../../src/ui/useSession';
import { useSettings } from '../../src/ui/useSettings';

interface DocumentPiP {
  requestWindow(opts: { width: number; height: number; preferInitialWindowPlacement?: boolean }): Promise<Window>;
}

const SIZE: Record<OverbarMode, { width: number; height: number }> = { collapsed: { width: 520, height: 76 }, expanded: { width: 520, height: 640 } };

let current: { win: Window; root: Root } | null = null;

function docPip(): DocumentPiP | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ?? null;
}

/** Document Picture-in-Picture (Chrome 116+): a window that stays on top of every app. */
export function popOutAvailable(): boolean {
  return docPip() !== null;
}

/**
 * "Pop out": the bar in an always-on-top window, so the line floats over Zoom, Slack or a second
 * screen while the rep looks away from HubSpot. Opens from the bar's button (it needs the click).
 * The overlay's styles live in its shadow root; they're copied into the new window's document.
 */
export async function popOut(shadow: ShadowRoot | null): Promise<boolean> {
  if (current) {
    current.win.focus();
    return true;
  }
  const api = docPip();
  if (!api) return false;
  const win = await api.requestWindow({ ...SIZE.collapsed, preferInitialWindowPlacement: false });
  const doc = win.document;
  doc.title = 'Cue';
  const fonts = doc.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = FONT_HREF;
  doc.head.append(fonts);
  for (const el of Array.from(shadow?.querySelectorAll('style') ?? [])) {
    const style = doc.createElement('style');
    style.textContent = el.textContent;
    doc.head.append(style);
  }
  for (const sheet of shadow?.adoptedStyleSheets ?? []) {
    const style = doc.createElement('style');
    style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
    doc.head.append(style);
  }
  doc.documentElement.style.height = '100%';
  doc.body.style.margin = '0';
  doc.body.style.height = '100%';
  const host = doc.createElement('div');
  host.style.height = '100%';
  doc.body.append(host);
  const root = createRoot(host);
  current = { win, root };
  root.render(<PoppedBar win={win} />);
  win.addEventListener('pagehide', () => {
    root.unmount();
    current = null;
  });
  return true;
}

export function closePopOut(): void {
  current?.win.close();
}

/** What the pop-out shows: the bar for the call on screen, nothing else. Closes itself after the call. */
function PoppedBar({ win }: { win: Window }) {
  const { state, levels } = useSession();
  const [settings] = useSettings();
  const [mode, setMode] = useState<OverbarMode>('collapsed');

  useEffect(() => {
    try {
      const size = SIZE[mode];
      win.resizeTo(Math.max(win.outerWidth, size.width), size.height + (win.outerHeight - win.innerHeight));
    } catch {
      /* resizing needs a gesture in the window: the rep can drag its edge */
    }
  }, [mode, win]);

  useEffect(() => {
    if (state.phase === 'idle') win.close();
  }, [state.phase, win]);

  const onAction = useCallback((suggestionId: string, action: SuggestionAction, text?: string) => {
    void request({ type: 'session.action', suggestionId, action, ...(text ? { text } : {}) });
  }, []);

  // Floating over other apps, Night Shift reads best; an explicit Signal choice is kept.
  const direction = settings?.direction === 'signal' ? 'signal' : 'night';
  return (
    <CueRoot direction={direction} theme={settings?.theme ?? 'system'} density="comfortable">
      <Overbar
        view={state.view}
        connection={state.connection}
        mode={mode}
        onModeChange={setMode}
        onAction={onAction}
        onEnd={() => void request({ type: 'session.end' })}
        placement="inline"
        voiceLevel={levels.prospect}
        drawers={{ transcript: false }}
      />
    </CueRoot>
  );
}
