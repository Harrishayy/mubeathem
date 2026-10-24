// Detector only. No UI -- the side panel renders everything.

// Trellus renders inside <template shadowrootmode="open">, so document.body.innerText
// and a plain querySelector cannot see it. Walk every open shadowRoot.
function deepQueryAll(sel, root = document, out = []) {
  try { out.push(...root.querySelectorAll(sel)); } catch (_) {}
  for (const el of (root.querySelectorAll ? root.querySelectorAll('*') : []))
    if (el.shadowRoot) deepQueryAll(sel, el.shadowRoot, out);
  return out;
}

const FREEMAIL = /^(gmail|outlook|hotmail|yahoo|icloud|proton(mail)?|aol|live|msn)\./i;

// Pull the company off a Trellus card. The card carries everything, so there is
// no ambiguity about which of the five answered.
function readCard(card) {
  if (!card) return null;
  const t = s => (card.querySelector(s)?.textContent || '').trim();
  const person = t('.name-text');
  const title = t('.title');                                   // "Role - Company"
  const email = t('.custom-tag__value');
  const company = title.includes(' - ') ? title.slice(title.lastIndexOf(' - ') + 3).trim() : '';
  const role = title.includes(' - ') ? title.slice(0, title.lastIndexOf(' - ')).trim() : title;
  const dom = /@/.test(email) ? email.split('@')[1] : '';
  const domain = dom && !FREEMAIL.test(dom) ? dom : null;      // "Casap" misses, casaphq.com resolves
  const key = domain || company || person;
  return key ? { key, name: company || person, domain, person, role, pageRecord: pageKey() } : null;
}

function recordKey() {
  const m = location.pathname.match(/\/record\/(\d+-\d+\/\d+)/);
  return m ? m[1] : '';
}
function pageKey() {
  return recordKey() || location.pathname;
}

const connected = () => readCard(deepQueryAll('.card[data-status="connected"]')[0]);

// Manual-brief fallback, for a record you have open rather than a live card.
// HubSpot's class names churn, so this leans on test-ids first and then on the
// page's own content -- three strategies, because a contact record does not
// always carry an associated-company chicklet.
const SKIP = /(^|\.)(hubspot|hs-sites|hubspotusercontent|hsforms|google|gstatic|googleapis|linkedin|facebook|twitter|x|youtube|instagram|apple|microsoft|cloudfront|w3|schema|example)\.[a-z.]+$/i;

function readHubspotRecord() {
  const q = s => (document.querySelector(s)?.textContent || '').trim();
  const clean = d => d.toLowerCase().replace(/^www\./, '').replace(/[.,;:)\]]+$/, '');
  let domain = clean(q('[data-test-id="company-chicklet-domain"]'));
  let company = q('[data-test-id="company-chicklet-title-link"]');
  let via = domain ? 'chicklet' : '';

  if (!domain) {
    const txt = document.body.innerText || '';
    for (const m of txt.matchAll(/[\w.+-]+@([\w-]+\.[\w.-]+)/g)) {
      const d = clean(m[1]);
      if (d && !FREEMAIL.test(d) && !SKIP.test(d)) { domain = d; via = 'email'; break; }
    }
  }

  if (!domain) {
    for (const a of deepQueryAll('a[href^="http"]')) {
      let h = ''; try { h = clean(new URL(a.href).host); } catch (_) { continue; }
      if (h && !SKIP.test(h) && !FREEMAIL.test(h)) { domain = h; via = 'link'; break; }
    }
  }

  if (!company) company = q('[data-test-id="highlight-property-display-company"]');
  if (!domain && !company) return null;

  const fromDomain = domain ? domain.split('.')[0].replace(/[-_]/g, ' ') : '';
  return { key: domain || company, name: company || fromDomain, domain: domain || null,
           person: q('[data-test-id="highlight-record-label"]'),
           role: q('[data-test-id="highlight-property-display-jobtitle"]'),
           via: via || 'name',
           pageRecord: pageKey() };
}

// After chrome.runtime.reload() the old content script is orphaned. chrome.runtime
// is then undefined / throws "Extension context invalidated" on every Trellus mutation.
function alive() {
  try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
  catch { return false; }
}
function sendMsg(msg) {
  if (!alive()) return;
  try { chrome.runtime.sendMessage(msg); } catch (_) {}
}

try {
  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m.k === 'read') { reply(connected() || readHubspotRecord() || null); return true; }
    if (m.k === 'ping') { reply({ ok: true }); return true; }
  });
} catch (_) {}

const warmed = new Set();
function prewarmRinging() {
  for (const st of ['ringing', 'pending-ringing', 'initiating']) {
    for (const card of deepQueryAll(`.card[data-status="${st}"]`)) {
      const co = readCard(card);
      if (co && !warmed.has(co.key)) {
        warmed.add(co.key);
        sendMsg({ type: 'prewarm', name: co.name });
      }
    }
  }
}

let autoReveal = true;
let hotkey = 'Alt+Shift+C';
try {
  chrome.storage.local.get({ autoReveal: true, hotkey: 'Alt+Shift+C' }, s => {
    if (!s) return;
    autoReveal = s.autoReveal !== false;
    if (s.hotkey) hotkey = s.hotkey;
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (!alive() || area !== 'local') return;
    if (c.autoReveal) autoReveal = c.autoReveal.newValue !== false;
    if (c.hotkey && c.hotkey.newValue) hotkey = c.hotkey.newValue;
  });
} catch (_) {}

const send = co => {
  if (!co || !autoReveal) return;
  closeFloodgate();
  sendMsg({ ...co, type: 'connect' });
};

// Fires only when a card flips to connected -- the dialer's own state, not a
// scraped counter. Opening a contact never triggers it.
//
// After connect, HubSpot jumps to that contact. That jump must not look like
// "user changed contact" or the brief never sticks. Close the floodgate,
// wait until the new page is stable, then open it so a later contact change
// can dismiss the brief.
let wasConnected = false;
let lastRecord = pageKey();
let floodgateOpen = true;
let discTimer = null;
let settleWatch = null;
const DISC_WAIT = 800;
const SETTLE_STABLE = 500;
const SETTLE_NOJUMP = 2000;
const SETTLE_CAP = 6000;

function openFloodgate() {
  if (settleWatch) { clearInterval(settleWatch); settleWatch = null; }
  lastRecord = pageKey();
  floodgateOpen = true;
  sendMsg({ type: 'page', record: lastRecord, settle: true });
}

function closeFloodgate() {
  floodgateOpen = false;
  if (settleWatch) { clearInterval(settleWatch); settleWatch = null; }
  const origin = pageKey();
  let seen = origin;
  let lastChange = Date.now();
  let jumped = false;
  const t0 = Date.now();
  settleWatch = setInterval(() => {
    if (!alive()) { clearInterval(settleWatch); settleWatch = null; return; }
    const rec = pageKey();
    if (rec !== seen) {
      seen = rec;
      lastChange = Date.now();
      if (rec !== origin) jumped = true;
    }
    const waited = Date.now() - t0;
    const stable = Date.now() - lastChange;
    if (jumped && stable >= SETTLE_STABLE) { openFloodgate(); return; }
    if (!jumped && waited >= SETTLE_NOJUMP && stable >= SETTLE_STABLE) { openFloodgate(); return; }
    if (waited >= SETTLE_CAP) openFloodgate();
  }, 120);
}

function checkPage() {
  if (!floodgateOpen) return;
  const rec = pageKey();
  if (rec === lastRecord) return;
  lastRecord = rec;
  sendMsg({ type: 'page', record: rec });
}

const mo = new MutationObserver(() => {
  if (!alive()) { try { mo.disconnect(); } catch (_) {} return; }
  prewarmRinging();
  const co = connected();
  if (co) {
    if (discTimer) { clearTimeout(discTimer); discTimer = null; }
    if (!wasConnected) send(co);
    wasConnected = true;
  } else if (wasConnected && !discTimer) {
    discTimer = setTimeout(() => {
      discTimer = null;
      if (connected()) return;
      wasConnected = false;
      warmed.clear();
      sendMsg({ type: 'disconnect' });
      if (!floodgateOpen && !settleWatch) closeFloodgate();
    }, DISC_WAIT);
  }
  checkPage();
});
if (document.body) {
  mo.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-status']
  });
}
setInterval(() => { if (alive()) checkPage(); }, 1000);

function parseHotkey(s) {
  const p = String(s || '').split('+').map(x => x.trim()).filter(Boolean);
  const key = (p.find(x => !/^(Ctrl|Control|Alt|Shift|Meta|Cmd|Command)$/i.test(x)) || '').toLowerCase();
  return {
    ctrl: p.some(x => /^(Ctrl|Control)$/i.test(x)),
    alt: p.some(x => /^Alt$/i.test(x)),
    shift: p.some(x => /^Shift$/i.test(x)),
    meta: p.some(x => /^(Meta|Cmd|Command)$/i.test(x)),
    key
  };
}

window.addEventListener('keydown', e => {
  if (e.repeat || !alive()) return;
  const h = parseHotkey(hotkey);
  if (!h.key) return;
  if (!h.alt && !h.ctrl && !h.meta) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (key !== h.key) return;
  if (!!e.altKey !== h.alt || !!e.ctrlKey !== h.ctrl || !!e.shiftKey !== h.shift || !!e.metaKey !== h.meta) return;
  e.preventDefault();
  sendMsg({ type: 'brief-page' });
}, true);
