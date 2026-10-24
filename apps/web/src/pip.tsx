import { FONT_HREF } from '@cue/ui';
import { createRoot, type Root } from 'react-dom/client';
import { hrefFor } from './router';
import { PipSurface } from './shell/PipSurface';
import { callStore } from './state/call';
import { uiStore } from './state/ui';

interface DocumentPiP {
  requestWindow(opts: { width: number; height: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  window: Window | null;
}

function docPip(): DocumentPiP | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ?? null;
}

export const PIP_SIZE = { collapsed: { width: 460, height: 76 }, expanded: { width: 460, height: 640 } };

let current: { win: Window; root: Root } | null = null;

export function pipSupported(): 'document' | 'popup' {
  return docPip() ? 'document' : 'popup';
}

export function pipWindow(): Window | null {
  return current?.win ?? null;
}

/** Copy every stylesheet (Vite's injected <style>s, the font link) into the pop-out document. */
function copyStyles(target: Document): void {
  const fonts = target.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = FONT_HREF;
  target.head.append(fonts);
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      const style = target.createElement('style');
      style.textContent = css;
      target.head.append(style);
    } catch {
      // Cross-origin sheet: link it instead.
      if (sheet.href) {
        const link = target.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.head.append(link);
      }
    }
  }
}

/** Resize the pop-out to fit the overbar mode. Needs a user gesture in the PiP window; best effort. */
export function fitPip(mode: 'collapsed' | 'expanded'): void {
  const w = current?.win;
  if (!w) return;
  const size = PIP_SIZE[mode];
  try {
    w.resizeTo(Math.max(w.outerWidth, size.width), size.height + (w.outerHeight - w.innerHeight));
  } catch {
    /* not allowed without activation: the user can drag the window edge */
  }
}

/**
 * "Pop out": the overbar in an always-on-top Document Picture-in-Picture window (Chrome 116+), so it
 * floats over Trellus, Zoom or any app. Elsewhere, a small popup window following the same call.
 */
export async function openPip(): Promise<'document' | 'popup' | 'blocked'> {
  if (current) {
    current.win.focus();
    return 'document';
  }
  const api = docPip();
  if (!api) {
    const id = callStore.get().callId;
    const url = `${location.pathname}${location.search}${hrefFor({ name: 'pip', id })}`;
    const w = window.open(url, 'cue-pop-out', `popup,width=${PIP_SIZE.expanded.width},height=${PIP_SIZE.expanded.height}`);
    return w ? 'popup' : 'blocked';
  }
  const mode = uiStore.get().overbar;
  const win = await api.requestWindow({ ...PIP_SIZE[mode], preferInitialWindowPlacement: false });
  win.document.title = 'Cue';
  copyStyles(win.document);
  win.document.documentElement.style.height = '100%';
  win.document.body.style.margin = '0';
  win.document.body.style.height = '100%';
  const host = win.document.createElement('div');
  host.id = 'cue-pip';
  host.style.height = '100%';
  win.document.body.append(host);
  const root = createRoot(host);
  current = { win, root };
  uiStore.set((u) => ({ ...u, pip: true }));
  root.render(<PipSurface win={win} />);
  win.addEventListener('pagehide', () => {
    root.unmount();
    current = null;
    uiStore.set((u) => ({ ...u, pip: false }));
  });
  return 'document';
}

export function closePip(): void {
  current?.win.close();
}
