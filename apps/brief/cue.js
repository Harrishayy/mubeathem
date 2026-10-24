// The live call session (service worker side). When Trellus marks a card connected, a call is
// created on the Cue server, the call tab's audio (the prospect) and the mic (the rep) are captured
// in an offscreen document and transcribed, and the brief this extension writes is sent along so the
// live cue knows what the rep already has on screen. The side panel follows the call over SSE.
//
// Loaded by background.js with importScripts, after config.js and cue.config.js.

const Cue = (() => {
  const OFFSCREEN = 'offscreen.html';
  let session = null;
  let briefSent = '';
  let briefTimer = null;

  async function cfg() {
    const s = await chrome.storage.local.get(['cueServer', 'cueToken', 'yourName']);
    const server = String(s.cueServer || (typeof CUE_SERVER === 'string' ? CUE_SERVER : '') || '').replace(/\/+$/, '');
    const token = s.cueToken || (typeof CUE_TOKEN === 'string' ? CUE_TOKEN : '') || '';
    return { server, token, rep: (s.yourName || 'Nick').trim() || 'Nick' };
  }

  async function api(path, body, method = 'POST') {
    const { server, token } = await cfg();
    if (!server) throw new Error('No Cue server set. Add CUE_SERVER to cue.config.js.');
    const res = await fetch(server + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-cue-token': token },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || text.slice(0, 200) || 'HTTP ' + res.status;
      throw Object.assign(new Error(res.status === 401 ? 'The Cue server refused the token (cue.config.js).' : msg), { status: res.status, code: json && json.error && json.error.code });
    }
    return json;
  }

  async function view() {
    if (!session) return null;
    const { server, token } = await cfg();
    return { ...session, server, token };
  }

  async function broadcast() {
    const v = await view();
    chrome.runtime.sendMessage({ type: 'cue', cue: v }).catch(() => {});
    try { chrome.storage.session.set({ cueSession: session }); } catch (_) {}
  }

  async function load() {
    if (session) return;
    try {
      const s = await chrome.storage.session.get('cueSession');
      if (!session && s.cueSession) session = s.cueSession;
    } catch (_) {}
  }

  const slug = s => String(s || 'rep').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'rep';

  /* ── capture ── */

  async function hasOffscreen() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN)] });
    return contexts.length > 0;
  }

  async function ensureOffscreen() {
    if (await hasOffscreen()) return;
    try {
      await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: ['USER_MEDIA'], justification: 'Hear the call tab and the microphone to transcribe the call for live suggestions.' });
    } catch (e) {
      if (!String(e).includes('Only a single offscreen')) throw e;
    }
  }

  function streamId(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
        const err = chrome.runtime.lastError;
        if (err || !id) reject(new Error((err && err.message) || 'No stream id'));
        else resolve(id);
      });
    });
  }

  function captureError(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('not been invoked') || s.includes('activetab') || s.includes('permission'))
      return 'Press Alt+Shift+L on the dialer tab so Chrome lets Cue hear the call.';
    if (s.includes('active stream')) return 'Another extension is already capturing this tab.';
    return raw;
  }

  async function sttToken() {
    try { return await api('/api/stt/token'); } catch (e) { return { error: e.code === 'stt_not_configured' ? 'Transcription is not set up on the server (DEEPGRAM_API_KEY).' : e.message }; }
  }

  async function startCapture(tabId) {
    if (!session || !session.callId) return;
    session.capture = { tab: { state: 'starting' }, mic: { state: 'starting' } };
    if (tabId) session.tabId = tabId;
    broadcast();
    let tabStream = null;
    if (session.tabId) {
      try { tabStream = await streamId(session.tabId); } catch (e) { session.capture.tab = { state: 'denied', message: captureError(e.message) }; }
    } else session.capture.tab = { state: 'denied', message: 'No call tab yet.' };
    const stt = await sttToken();
    if (stt.error) {
      session.capture.tab = { state: 'error', message: stt.error };
      session.capture.mic = { state: 'error', message: stt.error };
      broadcast();
      return;
    }
    await ensureOffscreen();
    const { server, token } = await cfg();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', callId: session.callId, startedAt: session.startedAt, server, token, tabStream, stt }).catch(() => {});
    broadcast();
  }

  async function stopCapture() {
    try { if (await hasOffscreen()) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }); } catch (_) {}
    try { if (await hasOffscreen()) await chrome.offscreen.closeDocument(); } catch (_) {}
  }

  /* ── the brief, sent to the server ── */

  const PRODUCT = [
    [/d\s*&\s*o|directors/i, 'd_and_o'],
    [/e\s*&\s*o|tech|errors/i, 'e_and_o'],
    [/cyber/i, 'cyber'],
    [/epli|employment/i, 'epli'],
    [/\bai\b/i, 'ai_liability'],
    [/general liability|cgl/i, 'general_liability']
  ];
  const productOf = name => (PRODUCT.find(([re]) => re.test(name)) || [null, 'other'])[1];
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

  function personaOf(role) {
    const t = String(role || '').toLowerCase();
    if (/assistant|receptionist|office manager|front desk/.test(t)) return 'gatekeeper';
    if (/ceo|chief executive|founder|owner|president/.test(t)) return 'ceo';
    if (/cfo|finance|controller/.test(t)) return 'cfo';
    if (/cto|engineer|developer/.test(t)) return 'engineer';
    if (/chief|vp|vice president|head of|director|partner/.test(t)) return 'other_exec';
    return 'unknown';
  }

  /** The panel's brief (background.js `state`) as the server's Brief. */
  function briefFrom(S) {
    const sy = S.synth || {};
    const e = S.edgar || {};
    const c = S.formc || {};
    const f = Object.assign({}, S.facts || {});
    const trigger = clip(sy.trigger, 240);
    const policies = (sy.policies || []).filter(p => p && p.name).slice(0, 4).map(p => ({ name: clip(p.name, 80), reason: clip(p.reason, 240) }));
    const sec = e.line ? { form: 'D', line: clip(e.line, 240), sure: !!e.sure } : c.line ? { form: 'C', line: clip(c.line, 240), sure: !!c.sure } : null;
    const facts = [
      f.stage && 'Stage: ' + f.stage,
      f.employees && 'Employees: ' + f.employees,
      f.founded && 'Founded: ' + f.founded,
      f.city && 'City: ' + f.city,
      e.firstRaise && 'First priced raise on file: likely no D&O yet',
      e.investors && 'Investors on the filing: ' + e.investors
    ].filter(Boolean).map(x => clip(x, 200)).slice(0, 12);
    const people = [...(e.people || []), ...(sy.people || [])].filter(p => p && p.name).slice(0, 10).map(p => ({ name: clip(p.name, 120), role: clip(p.role, 160) }));
    return {
      summary: clip(sy.blurb || [f.kind, f.does].filter(Boolean).join(': '), 400),
      hooks: policies.slice(0, 3).map(p => ({ hook: clip(p.name + ': ' + p.reason, 240), product: productOf(p.name), via: 'web' })),
      opener: trigger ? clip('I saw ' + trigger + '.', 320) : '',
      personaGuess: personaOf(S.co && S.co.role),
      servedBy: 'client',
      corgi: { trigger, risk: clip(sy.risk, 300), policies, people, sec, facts }
    };
  }

  /** Called on every panel update; sends the brief when it has changed (debounced). */
  function onBrief(S) {
    if (!session || !session.callId || session.status !== 'live' || !S || !S.co) return;
    if (session.co && S.co.key !== session.co.key) return;
    clearTimeout(briefTimer);
    briefTimer = setTimeout(async () => {
      const b = briefFrom(S);
      const key = JSON.stringify(b);
      if (key === briefSent || (!b.summary && !b.corgi.sec && !b.corgi.trigger)) return;
      briefSent = key;
      try { await api('/api/calls/' + session.callId + '/brief', b, 'PUT'); } catch (_) { briefSent = ''; }
    }, 400);
  }

  /* ── lifecycle ── */

  async function onConnect(co, tabId) {
    await load();
    if (session && session.status === 'live' && session.co && session.co.key === co.key) return;
    if (session && session.status === 'live') await onDisconnect();
    const { rep } = await cfg();
    session = { status: 'starting', co, tabId: tabId || null, startedAt: Date.now(), callId: null, capture: {}, outcome: null, error: null };
    briefSent = '';
    broadcast();
    try {
      const v = await api('/api/calls', {
        source: 'trellus',
        clientBrief: true,
        prospect: { name: co.person || co.name || 'Prospect', title: co.role || '', company: co.name || '', facts: co.domain ? { domain: co.domain } : {} },
        rep: { id: 'rep_' + slug(rep), name: rep }
      });
      if (!session || session.co !== co) return;
      session.callId = v.id;
      session.startedAt = v.startedAt;
      session.status = 'live';
      broadcast();
      if (typeof state !== 'undefined' && state && state.co && state.co.key === co.key) onBrief(state);
      await startCapture(tabId);
    } catch (e) {
      if (!session) return;
      session.status = 'error';
      session.error = e.message;
      broadcast();
    }
  }

  async function onDisconnect() {
    await load();
    if (!session || session.status !== 'live') return;
    session.status = 'ended';
    session.endedAt = Date.now();
    broadcast();
    await stopCapture();
    try { await api('/api/calls/' + session.callId + '/end', {}); } catch (_) {}
  }

  async function outcome(o) {
    await load();
    if (!session || !session.callId) return;
    if (session.status === 'live') await onDisconnect();
    session.outcome = o;
    session.status = 'learning';
    broadcast();
    try {
      await api('/api/calls/' + session.callId + '/end', { outcome: o });
      await api('/api/calls/' + session.callId + '/feedback', { outcome: o });
    } catch (e) {
      session.error = e.message;
    }
    broadcast();
  }

  async function dismiss() {
    await load();
    if (session && session.status === 'live') await onDisconnect();
    session = null;
    broadcast();
    try { chrome.storage.session.remove('cueSession'); } catch (_) {}
  }

  /** Alt+Shift+L on a tab: hear the call from this tab (activeTab is granted by the shortcut). */
  async function listenHere(tabId) {
    await load();
    if (!session || session.status !== 'live' || !tabId) return;
    await startCapture(tabId);
  }

  async function onOffscreen(m) {
    await load();
    if (!session) return;
    if (m.type === 'capture-status') {
      session.capture = Object.assign({}, session.capture, { [m.side]: m.status });
      broadcast();
    }
    if (m.type === 'stt-refresh') {
      const stt = await sttToken();
      if (!stt.error) chrome.runtime.sendMessage({ target: 'offscreen', type: 'stt', stt }).catch(() => {});
    }
  }

  return { onConnect, onDisconnect, onBrief, outcome, dismiss, listenHere, onOffscreen, view: async () => { await load(); return view(); } };
})();
