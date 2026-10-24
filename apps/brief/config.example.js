// Copy to config.js (gitignored) and fill in. Seeded into chrome.storage on first run; storage wins:
//   chrome.storage.local.set({ exaKey: 'NEW_KEY', geminiKey: 'NEW_KEY' })
const DEFAULT_EXA_KEY = '';
// Writes the brief from raw Exa snippets. Fastest / cheapest current 3.x model for JSON extraction.
const DEFAULT_GEMINI_KEY = '';
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

async function seedKey() {
  const { exaKey, yourName, geminiKey } = await chrome.storage.local.get(['exaKey', 'yourName', 'geminiKey']);
  if (!exaKey && DEFAULT_EXA_KEY) await chrome.storage.local.set({ exaKey: DEFAULT_EXA_KEY });
  if (!geminiKey && DEFAULT_GEMINI_KEY) await chrome.storage.local.set({ geminiKey: DEFAULT_GEMINI_KEY });
  if (!yourName) await chrome.storage.local.set({ yourName: 'Nick' });
}
seedKey();
