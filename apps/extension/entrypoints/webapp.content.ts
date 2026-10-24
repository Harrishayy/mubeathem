import { defineContentScript } from 'wxt/utils/define-content-script';
import { WEBAPP_DEV_MATCHES } from '../src/manifest';
import { loadSettings, publicSettings, updateSettings, watchSettings, webPatch } from '../src/settings';

/**
 * The bridge on the Cue web app: its Settings screen is where the rep changes how the extension
 * behaves (look, name, starting by itself, where the bar shows). Registered at runtime on the web
 * app's origins only (background.ts). It answers the page's ping with what the extension is set to,
 * and applies the fields the page may change (`webPatch`: never the server or the token). The page
 * and this isolated world talk by window.postMessage on the page's own origin.
 */
export default defineContentScript({
  matches: WEBAPP_DEV_MATCHES,
  registration: 'runtime',
  runAt: 'document_start',

  main(ctx) {
    const hello = async () => {
      const s = await loadSettings();
      window.postMessage({ source: 'cue-extension', type: 'hello', version: chrome.runtime.getManifest().version, settings: publicSettings(s) }, location.origin);
    };

    const onMessage = async (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data as { source?: unknown; type?: unknown; patch?: unknown } | null;
      if (!d || d.source !== 'cue-web') return;
      if (d.type === 'extension.ping') await hello();
      else if (d.type === 'extension.settings') {
        const patch = webPatch(d.patch, await loadSettings());
        // watchSettings answers with the new state.
        if (patch) await updateSettings(patch);
      }
    };

    window.addEventListener('message', onMessage);
    const stop = watchSettings(() => void hello());
    void hello();
    ctx.onInvalidated(() => {
      window.removeEventListener('message', onMessage);
      stop();
    });
  },
});
