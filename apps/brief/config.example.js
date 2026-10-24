// Copy to config.js (gitignored) and fill in. Seeded into chrome.storage on first run; storage wins:
//   chrome.storage.local.set({ exaKey: 'NEW_KEY' })
// The brief's writing (synth_brief) runs on the Cue server through Mubit, so no model key lives here.
const DEFAULT_EXA_KEY = '';

async function seedKey() {
  const { exaKey, yourName } = await chrome.storage.local.get(['exaKey', 'yourName']);
  if (!exaKey && DEFAULT_EXA_KEY) await chrome.storage.local.set({ exaKey: DEFAULT_EXA_KEY });
  if (!yourName) await chrome.storage.local.set({ yourName: 'Nick' });
}
seedKey();
