import '@cue/ui/styles.css';
import './overlay.css';
import { FONT_HREF } from '@cue/ui';
import { createRoot, type Root } from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { CONTENT_MATCHES, hostIdFor } from '../../src/hosts';
import { request, type PageContext } from '../../src/messages';
import { PageWatcher, type PageReading } from '../../src/ui/PageWatcher';
import { Overlay } from './Overlay';

/**
 * Host styles pinned inline with !important: inline important declarations beat any page rule,
 * including `* { all: unset !important }`. The host is a fixed, zero-size layer above the page;
 * everything visible is position: fixed inside the shadow root.
 */
const HOST_STYLE = [
  'all: initial',
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'overflow: visible',
  'z-index: 2147483646',
  'display: block',
  'pointer-events: none',
  'contain: style',
]
  .map((d) => `${d} !important`)
  .join('; ');

/** @font-face doesn't load from inside a Shadow DOM, so the web fonts go on the page. Fallbacks are metric-matched. */
function addFonts(doc: Document) {
  if (doc.querySelector('link[data-cue-fonts]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  link.dataset.cueFonts = '';
  (doc.head ?? doc.documentElement).append(link);
}

function toContext(r: PageReading, host: string): PageContext {
  return { tabId: null, host, prospect: r.prospect, trellus: { present: r.trellus.present, state: r.trellus.state } };
}

export default defineContentScript({
  matches: CONTENT_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const host = hostIdFor(location.hostname);
    if (!host) return;
    const top = window.top === window;

    // Inside a Trellus dialer iframe: no UI, just report the call state to the background.
    if (!top) {
      if (host !== 'trellus') return;
      const watcher = new PageWatcher(document, (r) => void request({ type: 'page.context', context: toContext(r, location.hostname) }), { inTrellusFrame: true });
      watcher.start();
      ctx.onInvalidated(() => watcher.stop());
      return;
    }

    addFonts(document);
    let reading: PageReading | null = null;
    let tabId: number | null = null;
    let root: Root | null = null;
    let shadowRoot: ShadowRoot | null = null;
    const render = () => root?.render(<Overlay host={host} reading={reading} tabId={tabId} shadow={shadowRoot} />);

    const watcher = new PageWatcher(
      document,
      (r) => {
        reading = r;
        render();
        void request<{ tabId: number | null }>({ type: 'page.context', context: toContext(r, location.hostname) }).then((res) => {
          if (res.ok && res.data.tabId !== tabId) {
            tabId = res.data.tabId;
            render();
          }
        });
      },
      { inTrellusFrame: host === 'trellus' },
    );

    const ui = await createShadowRootUi(ctx, {
      name: 'cue-overlay',
      position: 'inline',
      // On <html>, after <body>: a transform or filter on <body> (or an SPA replacing it) can't
      // capture our fixed positioning or take the overlay with it.
      anchor: () => document.documentElement,
      append: 'last',
      // Keys typed into Cue must not trigger HubSpot's or Trellus's own shortcuts.
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount(container, shadow, shadowHost) {
        shadowRoot = shadow;
        shadowHost.setAttribute('style', HOST_STYLE);
        container.setAttribute('style', 'pointer-events: auto');
        // A re-mount (the page threw our host away) reuses the same container and root.
        root ??= createRoot(container);
        render();
        return root;
      },
      onRemove(r) {
        r?.unmount();
        root = null;
      },
    });
    ui.mount();
    watcher.start();

    // If the page removes our host (some apps rebuild the document on navigation), put it back.
    const keepAlive = new MutationObserver(() => {
      if (!ui.shadowHost.isConnected) ui.mount();
    });
    keepAlive.observe(document.documentElement, { childList: true, subtree: false });

    ctx.onInvalidated(() => {
      watcher.stop();
      keepAlive.disconnect();
    });
  },
});
