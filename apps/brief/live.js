// The live section of the panel. Follows the call on the Cue server over SSE and shows, at the top
// of the brief, the one line to say next, what it's for, what they'll likely say after, and the
// transcript. After the call it asks how it went and shows what the playbook learned.

(() => {
  const el = document.getElementById('live');
  const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const MOMENT = {
    opener: 'Opener', gatekeeper: 'Gatekeeper', whats_this_regarding: '"What\'s this regarding?"',
    brush_off_email: 'Brush-off: send an email', brush_off_busy: 'Brush-off: busy', objection_broker: 'Objection: broker',
    objection_not_interested: 'Objection: not interested', objection_price: 'Objection: price', objection_timing: 'Objection: timing',
    buying_signal: 'Buying signal', close: 'Close', small_talk: 'Small talk', compliance: 'Compliance', voicemail: 'Voicemail',
    wrap_up: 'Wrap-up', other: 'Other'
  };
  const MOOD = { warm: 'warm', neutral: 'neutral', cool: 'cooling', cold: 'cold' };
  const OUTCOMES = [
    ['meeting_booked', 'Booked'], ['follow_up', 'Follow-up'], ['callback_requested', 'Callback'],
    ['not_interested', 'Not interested'], ['gatekeeper_blocked', 'Gatekeeper'], ['voicemail', 'Voicemail']
  ];

  let cue = null;
  let es = null;
  let followed = null;
  let V = null;
  let clock = null;
  let showTranscript = false;

  const fresh = () => ({ turns: new Map(), cards: new Map(), current: null, situation: null, review: null, playbook: null, error: null, skipped: null, ended: false });

  function close() {
    if (es) es.close();
    es = null;
    followed = null;
  }

  function follow() {
    if (!cue || !cue.callId || !cue.server) { close(); return; }
    if (followed === cue.callId) return;
    close();
    V = fresh();
    followed = cue.callId;
    es = new EventSource(cue.server + '/api/calls/' + cue.callId + '/stream?token=' + encodeURIComponent(cue.token || ''));
    es.addEventListener('view', e => { snapshot(JSON.parse(e.data).view); draw(); });
    es.addEventListener('event', e => { apply(JSON.parse(e.data).event); draw(); });
    // EventSource reconnects by itself and resumes from the last event id.
  }

  function snapshot(v) {
    V = fresh();
    for (const t of v.turns || []) V.turns.set(t.id, t);
    for (const h of v.history || []) V.cards.set(h.suggestion.id, h.suggestion);
    V.current = v.current;
    V.situation = v.situation;
    V.review = v.review;
    V.error = v.lastError ? v.lastError.message : null;
    V.ended = v.status !== 'live';
  }

  function apply(e) {
    if (!V) V = fresh();
    switch (e.type) {
      case 'turn.added': V.turns.set(e.turn.id, e.turn); break;
      case 'suggestion.shown':
        V.cards.set(e.suggestion.id, e.suggestion);
        if (!V.current || V.current.id === e.suggestion.id || e.suggestion.createdAt >= V.current.createdAt) V.current = e.suggestion;
        V.skipped = null;
        break;
      case 'suggestion.skipped': V.skipped = e.reason; break;
      case 'situation.read': V.situation = e.situation; break;
      case 'pipeline.error': V.error = e.message; break;
      case 'call.ended': V.ended = true; break;
      case 'review.completed': V.review = e.review; break;
      case 'playbook.updated': V.playbook = { scored: (e.lineIds || []).length, added: (e.candidatesAdded || []).length }; break;
    }
  }

  const tick = (label, s) => {
    const st = s && s.state;
    const cls = st === 'on' ? 'ok' : st === 'starting' || !st ? 'wait' : 'no';
    const mark = st === 'on' ? '✓' : st === 'starting' || !st ? '·' : '✗';
    return `<span class="${cls}">${label} <b>${mark}</b></span>`;
  };

  const elapsed = from => {
    const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  function transcriptHtml() {
    const turns = [...V.turns.values()].sort((a, b) => a.tMs - b.tMs).slice(-8);
    if (!turns.length) return '<div class="miss">listening…</div>';
    return `<ul class="tx">${turns.map(t => `<li class="${t.speaker}${t.final === false ? ' interim' : ''}"><b>${t.speaker === 'rep' ? 'You' : 'Them'}</b> ${esc(t.text)}</li>`).join('')}</ul>`;
  }

  function cardHtml() {
    const c = V.current;
    const turns = [...V.turns.values()];
    const talking = turns.some(t => t.speaker === 'prospect' && t.final === false && (!c || t.tMs > (c.createdAt - cue.startedAt)));
    if (!c) {
      const why = V.error && /MUBIT_API_KEY/.test(V.error) ? 'The Cue server has no Mubit key yet.' : talking ? 'listening…' : V.skipped && /^quiet/.test(V.skipped) ? 'Nothing to add: keep going.' : 'The line to say appears here when they speak.';
      return `<div class="h">Say next</div><div class="miss">${esc(why)}</div>`;
    }
    const s = c.situation || {};
    const evidence = c.evidence && c.evidence.text ? c.evidence.text : '';
    const ms = typeof c.latencyMs === 'number' ? ' · ' + c.latencyMs + ' ms' : '';
    return `<div class="h saynext">Say next <span class="tag">${esc(MOMENT[s.moment] || s.moment || '')}${s.receptivity ? ' · ' + esc(MOOD[s.receptivity] || s.receptivity) : ''}</span></div>
      <p class="say">${esc(c.say)}</p>
      <div class="why">${esc(c.why || '')}${c.why && evidence && c.why !== evidence ? ' · ' : ''}${c.why !== evidence ? esc(evidence) : ''}${esc(ms)}</div>
      ${s.rationale ? `<div class="meaning">${esc(s.rationale)}</div>` : ''}
      ${(c.upNext || []).length ? `<div class="h">If they say</div><ul>${c.upNext.map(u => `<li><b>"${esc(u.ifTheySay)}"</b> ${esc(u.move)}</li>`).join('')}</ul>` : ''}
      ${talking ? '<div class="miss">they\'re talking…</div>' : ''}`;
  }

  function afterHtml() {
    if (cue.status === 'ended') {
      return `<div class="h">How did it go?</div>
        <div class="outs">${OUTCOMES.map(([k, l]) => `<button class="out${k === 'meeting_booked' ? ' main' : ''}" data-out="${k}">${l}</button>`).join('')}</div>
        <div class="miss">Cue learns from the outcome: lines that book meetings get shown more.</div>`;
    }
    const label = (OUTCOMES.find(o => o[0] === cue.outcome) || [0, cue.outcome])[1];
    const pb = V && V.playbook;
    const rv = V && V.review;
    return `<div class="h">Logged: ${esc(label)}</div>
      ${pb ? `<p class="plain">Playbook updated: ${pb.scored} line${pb.scored === 1 ? '' : 's'} scored${pb.added ? `, ${pb.added} new line${pb.added === 1 ? '' : 's'} from you` : ''}.</p>` : '<div class="miss">Learning from this call…</div>'}
      ${rv && rv.summary ? `<p class="plain">${esc(rv.summary)}</p>` : ''}
      ${rv && (rv.whatWorked || []).length ? `<ul>${rv.whatWorked.slice(0, 2).map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="outs"><button class="out" data-done>Done</button></div>`;
  }

  function draw() {
    clearInterval(clock);
    if (!cue) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    if (cue.status === 'error') {
      el.innerHTML = `<div class="body"><div class="err">Cue: ${esc(cue.error || 'could not start')}</div><div class="outs"><button class="out" data-done>Dismiss</button></div></div>`;
      return;
    }
    const live = cue.status === 'live' || cue.status === 'starting';
    const cap = cue.capture || {};
    const problems = [cap.tab, cap.mic].filter((s, i, all) => s && s.message && s.state !== 'on' && all.findIndex(x => x && x.message === s.message) === i);
    el.innerHTML = `<div class="body">
      <div class="top">
        <div class="co">${live ? `<span class="dot"></span>Live <span id="clock">${elapsed(cue.startedAt)}</span>` : 'Call ended'}</div>
        <div class="ticks">${tick('THEM', cap.tab)}${tick('YOU', cap.mic)}${tick('CUE', { state: cue.callId ? 'on' : 'starting' })}</div>
      </div>
      ${problems.map(p => `<div class="err">${esc(p.message)}${p.state === 'denied' && /Microphone/.test(p.message) ? ' <button class="out" data-mic>Allow microphone</button>' : ''}</div>`).join('')}
      ${V ? cardHtml() : '<div class="miss">connecting…</div>'}
      ${!live ? afterHtml() : ''}
      ${V ? `<div class="fold${showTranscript ? '' : ' off'}"><button type="button" class="foldh" data-tx>Transcript</button><div class="foldb">${transcriptHtml()}</div></div>` : ''}
    </div>`;
    if (live) clock = setInterval(() => { const c = document.getElementById('clock'); if (c) c.textContent = elapsed(cue.startedAt); }, 1000);
  }

  el.addEventListener('click', e => {
    const out = e.target.closest('[data-out]');
    if (out) { chrome.runtime.sendMessage({ type: 'cue-outcome', outcome: out.dataset.out }); return; }
    if (e.target.closest('[data-done]')) { chrome.runtime.sendMessage({ type: 'cue-dismiss' }); return; }
    if (e.target.closest('[data-mic]')) { chrome.runtime.sendMessage({ type: 'cue-mic' }); return; }
    if (e.target.closest('[data-tx]')) { showTranscript = !showTranscript; draw(); }
  });

  function set(c) {
    cue = c || null;
    if (!cue) { close(); V = null; }
    else follow();
    draw();
  }

  chrome.runtime.sendMessage({ type: 'cue-get' }, r => set(r && r.cue));
  chrome.runtime.onMessage.addListener(m => { if (m.type === 'cue') set(m.cue); });
})();
