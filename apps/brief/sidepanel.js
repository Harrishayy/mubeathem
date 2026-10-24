const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const list = v => (Array.isArray(v) ? v : []).filter(Boolean);

let S = null, settings = { autoReveal: true, hotkey: 'Alt+Shift+C', theme: 'light', yourName: 'Nick', foldOpener: false, foldValue: false };
let menuOpen = false, capturing = false, timer = null, webOpen = false;
const mastEl = document.getElementById('mast');
const briefEl = document.getElementById('brief');
const webEl = document.getElementById('web');

function siteUrl(S) {
  let d = S && S.co && S.co.domain;
  if (!d) return '';
  d = String(d).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return d.includes('.') ? 'https://' + d : '';
}

function syncWeb() {
  const miss = document.getElementById('webmiss');
  const frame = document.getElementById('webframe');
  const url = siteUrl(S);
  if (webEl && mastEl) webEl.style.top = mastEl.offsetHeight + 'px';
  document.body.classList.toggle('web-on', webOpen);
  if (!url) {
    if (frame.dataset.loaded) {
      frame.dataset.loaded = '';
      frame.removeAttribute('src');
      frame.src = 'about:blank';
    }
    miss.classList.toggle('is-on', webOpen);
    return;
  }
  miss.classList.remove('is-on');
  if (frame.dataset.loaded !== url) {
    frame.dataset.loaded = url;
    frame.src = url;
  }
  if (webOpen) requestAnimationFrame(() => { try { frame.focus(); } catch (_) {} });
}

chrome.storage.local.get({ autoReveal: true, hotkey: 'Alt+Shift+C', theme: 'light', yourName: 'Nick', foldOpener: false, foldValue: false }, s => {
  settings = {
    autoReveal: s.autoReveal !== false,
    hotkey: s.hotkey || 'Alt+Shift+C',
    theme: s.theme === 'dark' ? 'dark' : 'light',
    yourName: (s.yourName || 'Nick').trim() || 'Nick',
    foldOpener: !!s.foldOpener,
    foldValue: !!s.foldValue
  };
  if (!s.yourName) chrome.storage.local.set({ yourName: 'Nick' });
  applyTheme();
  draw();
});
chrome.runtime.sendMessage({ type: 'panel-ready' }, r => { if (r?.state) { S = r.state; draw(); } });
chrome.runtime.onMessage.addListener(m => {
  if (m.type !== 'state') return;
  const prev = S && S.co && S.co.key;
  S = m.state;
  const wasOpen = webOpen;
  if (!S) webOpen = false;
  else if (S.co && S.co.key !== prev) webOpen = false;
  if (wasOpen && webOpen) {
    syncWeb();
    return;
  }
  draw();
});

function applyTheme() { document.body.dataset.theme = settings.theme; }
function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.local.set(patch);
  applyTheme();
  const nm = document.querySelector('[data-yourname]');
  const focused = nm && document.activeElement === nm;
  const pos = focused ? nm.selectionStart : null;
  draw();
  if (focused) {
    const el = document.querySelector('[data-yourname]');
    if (el) { el.focus(); if (pos != null) el.setSelectionRange(pos, pos); }
  }
}

function names(person) {
  const raw = String(person || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { first: '', last: '', full: '' };
  const i = raw.indexOf(' ');
  if (i < 0) return { first: raw, last: '', full: raw };
  return { first: raw.slice(0, i), last: raw.slice(i + 1), full: raw };
}

function triggerOf(S) {
  const tidy = s => {
    let t = String(s || '').trim()
      .replace(/^["“”']+|["“”']+$/g, '')
      .replace(/^i saw\s+/i, '');
    t = t.split(/\s*,?\s+but\s+/i)[0];
    t = t.replace(/[.?!]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    t = t.replace(/^[A-Z]/, c => c.toLowerCase());
    const n = t.split(/\s+/).length;
    if (n < 4 || n > 16) return '';
    if (/\b(liabilit|coverage|doesn'?t cover|does not cover|data breach|product liability|general liability|d\s*&\s*o)\b/i.test(t))
      return '';
    if (!/^you(?:'re| are)\s+[a-z]+ing\b/i.test(t)) return '';
    if (/\b(raised?|raising|seed|hiring|you(?:'re| are) live with)\b/i.test(t)) return '';
    return t;
  };
  const fromSynth = tidy(S.synth && S.synth.trigger);
  if (fromSynth) return fromSynth;
  return '';
}

function openerHtml(S) {
  const n = names(S.co && S.co.person);
  const who = (settings.yourName || 'Nick').trim() || 'Nick';
  const coName = String(S.co && S.co.name || '').trim();
  const same = n.full && coName && (
    n.full.toLowerCase() === coName.toLowerCase()
    || n.first.toLowerCase() === coName.toLowerCase()
  );
  const hey = n.first && !same ? `Hey ${n.first}` : 'Hey';
  const trig = triggerOf(S);
  const pending = !trig && S.synth === undefined;
  const slot = pending
    ? '<span class="wait">writing…</span>'
    : trig ? esc(trig) : '<span class="wait">nothing specific found</span>';
  return `<div class="opener">
    <p>${esc(hey)}, this is ${esc(who)} from Corgi.</p>
    <p>I'll be honest, this is a cold call, but a researched one.</p>
    <p>I saw ${slot}.</p>
    <p>Can I take 30 seconds on why I called, and you tell me if it's worth continuing?</p>
  </div>`;
}

function valueHtml(S) {
  const co = (S && S.co && S.co.name) || 'the company';
  return `<div class="opener">
    <p>Corgi's the first AI native insurance carrier. I know insurance is pretty boring, but it matters more than you think.</p>
    <p>We're backed by Y Combinator, and we work with thousands of startups, including Deel and Artisan.</p>
    <p>There's two things we do differently from traditional insurance companies. First, speed — we're the actual carrier, so you get a quote in minutes and coverage the same day, instead of weeks with a broker. Second, price — no middleman means clients typically save 20 to 30 percent.</p>
    <p>So what's the situation over at ${esc(co)} on the business coverage side right now?</p>
  </div>`;
}

function rest(s) {
  s = String(s || '').trim().replace(/\*\*(.+?)\*\*/g, '$1');
  const m = s.match(/^.+?\s+[—–:]\s+(.+)$/) || s.match(/^.+?\s+-\s+(.+)$/);
  return m ? m[1] : s;
}

function src(label, pending, used) {
  const cls = used ? 'ok' : pending ? 'wait' : 'no';
  const mark = used ? '✓' : pending ? '·' : '✗';
  return `<span class="${cls}">${esc(label)} <b>${mark}</b></span>`;
}

function mergePeople(S) {
  const out = [], seen = new Set();
  const add = (name, role) => {
    const k = (name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!k) return;
    if (seen.has(k)) {
      const p = out.find(x => x.k === k);
      if (p && role && role.length > (p.role || '').length) p.role = role;
      return;
    }
    seen.add(k);
    out.push({ k, name, role: role || '' });
  };
  for (const p of list(S.edgar && S.edgar.people)) add(p.name, p.role);
  for (const p of list(S.formc && S.formc.people)) add(p.name, p.role);
  for (const p of list(S.wiki && S.wiki.people)) add(p.name, p.role);
  for (const p of list(S.synth && S.synth.people)) add(p.name, p.role);
  return out;
}

function describe(S) {
  if (S.synth && S.synth.blurb) return S.synth.blurb;
  const f = S.facts || {}, w = S.wiki || {}, e = S.edgar || {};
  const live = !!(S.rdap && S.rdap.hit);
  if (f.blurb && !(live && /dissolved|defunct|wound up/i.test(f.blurb))) return f.blurb;
  const city = f.city || w.hq || (S.gleif && S.gleif.city) || [e.city, e.state].filter(Boolean).join(', ') || [S.formc && S.formc.city, S.formc && S.formc.state].filter(Boolean).join(', ');
  const s1 = [f.kind, city ? 'based in ' + city : ''].filter(Boolean).join(' ');
  const s2 = [f.does, f.targeting ? 'targeting ' + f.targeting : ''].filter(Boolean).join(', ');
  const out = [s1, s2].filter(Boolean).map(s => s.replace(/^[a-z]/, c => c.toUpperCase()).replace(/\.$/, '')).join('. ');
  if (out) return out + '.';
  if (S.rdap && S.rdap.registered)
    return 'Domain registered ' + S.rdap.registered + '. No public product description yet.';
  return '';
}

function details(S) {
  const f = S.facts || {}, w = S.wiki || {}, e = S.edgar || {}, g = S.gleif || {}, r = S.rdap || {}, c = S.formc || {};
  const rows = [];
  const add = (k, v) => { if (v && String(v).trim() && String(v) !== 'unclear') rows.push(`<li><b>${esc(k)}</b> ${esc(v)}</li>`); };
  add('Employees', f.employees || w.employees || c.employees);
  let founded = f.founded || w.inception || g.created || e.yearInc || c.yearInc || '';
  if (/^\d{4}$/.test(founded)) {
    const age = new Date().getFullYear() - +founded;
    if (age >= 0 && age < 80) founded = founded + ` (${age} yr${age === 1 ? '' : 's'})`;
  }
  add('Founded', founded);
  add('Domain', r.registered ? 'registered ' + r.registered : '');
  add('Est. valuation', f.valuation);
  const stage = f.stage;
  if (stage && !(r.hit && /dissolved|defunct/i.test(stage))) add('Stage', stage);
  add('Legal', g.legal && g.status ? g.legal + ' · ' + g.status : g.legal);
  add('Jurisdiction', g.jurisdiction || c.jurisdiction);
  add('Entity', e.entityType || c.entityType);
  add('Industry', e.industry);
  return rows;
}

const svgRefresh = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`;
const svgCog = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

function mast(waiting) {
  const url = siteUrl(S);
  return `<button class="webbtn${webOpen ? ' on' : ''}" data-web ${url ? '' : 'disabled'} title="${url ? 'Show company website' : 'No website on this contact'}">Website</button>
    <div class="acts">
      <button class="ico refresh${waiting ? ' spin' : ''}" data-brief title="Refresh">${svgRefresh}</button>
      <button class="ico" data-cog title="Settings">${svgCog}</button>
    </div>
    ${menuOpen ? menuHtml() : ''}`;
}

function menuHtml() {
  return `<div class="menu" data-menu>
    <div class="opt"><span>Your name</span>
      <input class="nm" data-yourname maxlength="40" spellcheck="false" value="${esc(settings.yourName)}"></div>
    <div class="opt"><span>Auto-reveal on connect</span>
      <button class="sw${settings.autoReveal ? ' on' : ''}" data-toggle="autoReveal" aria-label="Auto-reveal"><i></i></button></div>
    <div class="opt"><span>Hotkey</span>
      <button class="hk${capturing ? ' cap' : ''}" data-hotkey>${capturing ? 'Press keys…' : esc(settings.hotkey)}</button></div>
    <div class="opt"><span>Dark theme</span>
      <button class="sw${settings.theme === 'dark' ? ' on' : ''}" data-toggle="theme" aria-label="Dark theme"><i></i></button></div>
  </div>`;
}

function section(title, inner) {
  return inner ? `<div class="h">${title}</div>${inner}` : '';
}
function foldSection(key, title, inner) {
  if (!inner) return '';
  const off = !!settings[key];
  return `<div class="fold${off ? ' off' : ''}">
    <button type="button" class="foldh" data-fold="${key}" aria-expanded="${off ? 'false' : 'true'}">${title}</button>
    <div class="foldb">${inner}</div>
  </div>`;
}

function draw() {
  clearInterval(timer);
  applyTheme();
  const waiting = !!(S && !S.error && (S.exa === undefined || S.edgar === undefined || S.formc === undefined || S.wiki === undefined || S.gleif === undefined || S.rdap === undefined || S.synth === undefined));
  if (waiting) timer = setInterval(() => {
    const el = document.getElementById('elapsed');
    if (el && S) el.textContent = ((Date.now() - S.t0) / 1000).toFixed(1) + 's';
  }, 100);

  if (!S) {
    mastEl.innerHTML = mast(false);
    briefEl.innerHTML = `<div class="body"><div class="idle">
      <b>Waiting for a connect</b>
      Picks up the moment Trellus marks someone connected.${settings.autoReveal ? '' : '<br>Auto-reveal is off — use refresh or the hotkey.'}
    </div></div>`;
    syncWeb();
    return;
  }
  if (S.error) {
    mastEl.innerHTML = mast(false);
    briefEl.innerHTML = `<div class="body"><div class="err">${esc(S.error)}</div></div>`;
    syncWeb();
    return;
  }

  const { co, edgar: e, formc: c, wiki: w, gleif: g, rdap: rd, exa, synth: sy, t0 } = S;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const host = String(co.domain || '').replace(/^www\./i, '').toLowerCase();
  const exaUsed = host ? !!(exa && exa.onSite > 0) : !!(exa && exa.hit);
  const exaPending = exa === undefined;
  const people = mergePeople(S);
  const det = details(S);
  const peoplePending = sy === undefined && !(e && list(e.people).length) && !(c && list(c.people).length) && !(w && list(w.people).length);
  const who = names(co.person);

  const extras = [];
  if (e && e.line) {
    if (e.firstRaise) extras.push('<li><b>First raise</b> on file — likely no incumbent D&amp;O</li>');
    else if (e.raises > 1) extras.push(`<li><b>${esc(e.raises)} raises</b> on file${e.prevRaise ? `, previous ${esc(e.prevRaise)}` : ''}</li>`);
    if (e.securities) extras.push(`<li><b>Securities</b> ${esc(e.securities)}</li>`);
    if (e.minInvest) extras.push(`<li><b>Min. check</b> ${esc(e.minInvest)}</li>`);
    if (e.filed) extras.push(`<li><b>Filed</b> ${esc(e.filed)}</li>`);
    if (e.sure && e.name && e.name !== co.name) extras.push(`<li><b>Legal name</b> ${esc(e.name)}</li>`);
  }
  const formInner = e && e.line ? `
      <div class="line">${esc(e.line)}</div>
      <div class="grid">
        <div><span>Raised</span><b>${esc(e.off)}</b></div>
        <div><span>Sold</span><b>${esc(e.sold)}</b></div>
        <div><span>Investors</span><b>${esc(e.investors ?? '—')}</b></div>
      </div>
      ${extras.length ? `<ul>${extras.join('')}</ul>` : ''}`
    : e ? `<div class="miss">No filing matched (${esc(e.miss || '—')})</div>`
        : `<div class="miss">checking EDGAR…</div>`;

  const cfExtras = [];
  if (c && c.line) {
    if (c.sold) cfExtras.push(`<li><b>Raised so far</b> ${esc(c.sold)}</li>`);
    if (c.portal) cfExtras.push(`<li><b>Portal</b> ${esc(c.portal)}</li>`);
    if (c.security) cfExtras.push(`<li><b>Security</b> ${esc(c.security)}</li>`);
    if (c.filed) cfExtras.push(`<li><b>Filed</b> ${esc(c.filed)}</li>`);
    if (c.sure && c.name && c.name !== co.name) cfExtras.push(`<li><b>Legal name</b> ${esc(c.name)}</li>`);
  }
  const formCInner = c && c.line ? `
      <div class="line">${esc(c.line)}</div>
      <div class="grid">
        <div><span>Min</span><b>${esc(c.target || '—')}</b></div>
        <div><span>Cap</span><b>${esc(c.cap || '—')}</b></div>
        <div><span>Deadline</span><b>${esc(c.deadline || '—')}</b></div>
      </div>
      ${cfExtras.length ? `<ul>${cfExtras.join('')}</ul>` : ''}`
    : c ? `<div class="miss">No filing matched (${esc(c.miss || '—')})</div>`
        : `<div class="miss">checking EDGAR…</div>`;

  const peopleInner = people.length
    ? `<ul>${people.map(p => `<li><b>${esc(p.name)}</b>${p.role ? ' ' + esc(p.role) : ''}</li>`).join('')}</ul>`
    : peoplePending ? `<div class="miss">looking up…</div>` : '';

  const blurb = (sy && sy.blurb) || describe(S);
  const riskLine = String((sy && sy.risk) || '').replace(/\*\*/g, '').trim();
  const pols = list(sy && sy.policies);
  const synthWait = sy === undefined;

  mastEl.innerHTML = mast(waiting);
  briefEl.innerHTML = `<div class="body">
    ${who.full && who.full.toLowerCase() !== String(co.name || '').toLowerCase() ? `<div class="who">${esc(who.first)}${who.last ? ' ' + esc(who.last) : ''}</div>` : ''}
    <div class="top">
      <div class="co">${esc(co.name)}</div>
      <div class="ticks">
        ${src('EXA', exaPending, exaUsed)}
        ${src('SEC', e === undefined && c === undefined, !!(e && e.line) || !!(c && c.line))}
        ${src('WIKI', w === undefined, !!(w && w.hit))}
        ${src('GLEIF', g === undefined, !!(g && g.hit))}
        ${src('RDAP', rd === undefined, !!(rd && rd.hit))}
      </div>
    </div>
    ${foldSection('foldOpener', 'Opener', openerHtml(S))}
    ${foldSection('foldValue', 'Value', valueHtml(S))}
    ${section('Form D', formInner)}
    ${section('Form C', formCInner)}
    ${section('C-suite', peopleInner)}
    ${section('Company details', det.length ? `<ul>${det.join('')}</ul>` : (synthWait ? `<div class="miss">looking up…</div>` : ''))}
    ${section('Company description', blurb ? `<p class="plain">${esc(blurb)}</p>` : (synthWait ? `<div class="miss">looking up…</div>` : `<div class="miss">Nothing specific found.</div>`))}
    ${section('Biggest risk', riskLine ? `<p class="plain">${esc(riskLine)}</p>` : (synthWait ? `<div class="miss">looking up…</div>` : ''))}
    ${section('Suggested policies', pols.length
      ? `<ul>${pols.map(p => `<li><b>${esc(p.name)}</b> ${esc(rest(p.reason))}</li>`).join('')}</ul>`
      : (synthWait ? `<div class="miss">looking up…</div>` : ''))}
    <div class="foot"><span>${esc(co.domain || co.key)}${co.via ? ' · via ' + esc(co.via) : ''}</span><span id="elapsed">${waiting ? secs + 's' : 'ready in ' + secs + 's'}</span></div>
  </div>`;
  syncWeb();
}

app.addEventListener('click', e => {
  if (e.target.closest('[data-web]')) {
    if (!siteUrl(S)) return;
    webOpen = !webOpen;
    const btn = e.target.closest('[data-web]');
    if (btn) btn.classList.toggle('on', webOpen);
    syncWeb();
    return;
  }
  const fold = e.target.closest('[data-fold]');
  if (fold) {
    const k = fold.dataset.fold;
    settings[k] = !settings[k];
    chrome.storage.local.set({ [k]: settings[k] });
    const box = fold.closest('.fold');
    if (box) box.classList.toggle('off', settings[k]);
    fold.setAttribute('aria-expanded', settings[k] ? 'false' : 'true');
    return;
  }
  if (e.target.closest('[data-brief]')) {
    chrome.runtime.sendMessage({ type: 'brief-page' });
    return;
  }
  if (e.target.closest('[data-cog]')) { menuOpen = !menuOpen; capturing = false; draw(); return; }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const k = tog.dataset.toggle;
    if (k === 'autoReveal') save({ autoReveal: !settings.autoReveal });
    if (k === 'theme') save({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
    return;
  }
  if (e.target.closest('[data-hotkey]')) { capturing = true; draw(); return; }
  if (menuOpen && !e.target.closest('[data-menu]')) { menuOpen = false; capturing = false; draw(); }
});

app.addEventListener('input', e => {
  const inp = e.target.closest('[data-yourname]');
  if (!inp) return;
  save({ yourName: inp.value });
});

app.addEventListener('focusout', e => {
  const inp = e.target.closest && e.target.closest('[data-yourname]');
  if (!inp) return;
  const v = inp.value.trim() || 'Nick';
  if (v !== settings.yourName) save({ yourName: v });
});

window.addEventListener('keydown', e => {
  if (e.target && e.target.closest && e.target.closest('[data-yourname]')) return;
  if (!capturing) return;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  capturing = false;
  save({ hotkey: parts.join('+') });
}, true);

draw();
