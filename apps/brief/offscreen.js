// Offscreen document: hears the call and transcribes it. The call tab's audio is the prospect, the
// microphone is the rep. Each goes to Deepgram over its own WebSocket (short-lived token from the Cue
// server), and every interim and final is posted straight to the server, where the live cue starts
// on an interim that looks finished.

let call = null; // { callId, startedAt, server, token, stt }
let ctx = null;
const streams = [];
const sockets = [];

const send = m => chrome.runtime.sendMessage(m).catch(() => {});
const status = (side, s) => send({ type: 'capture-status', side, status: s });

/* ── turns → server ── */

const lastInterim = new Map();
const INTERIM_GAP_MS = 250;

function postTurn(turn) {
  if (!call) return;
  // Interims are throttled per utterance; finals always go straight out.
  if (!turn.final) {
    const prev = lastInterim.get(turn.id);
    if (prev !== undefined && Date.now() - prev < INTERIM_GAP_MS) return;
    lastInterim.set(turn.id, Date.now());
  } else lastInterim.delete(turn.id);
  fetch(call.server + '/api/calls/' + call.callId + '/turns', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cue-token': call.token },
    body: JSON.stringify(turn),
    keepalive: true
  }).catch(() => {});
}

/* ── Deepgram ── */

const turnId = () => 'turn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Folds Deepgram's results into utterances: finals accumulate until speech_final or UtteranceEnd. */
function assembler(speaker, offsetMs) {
  let finals = [], id = null, startSec = null, endSec = 0;
  const turn = (text, final) => ({
    id, speaker, text: text.slice(0, 4000), final,
    tMs: Math.max(0, Math.round(offsetMs + (startSec || 0) * 1000)),
    durMs: Math.max(0, Math.round((endSec - (startSec || 0)) * 1000)),
    via: 'deepgram'
  });
  const close = () => {
    const words = finals.join(' ').trim();
    const t = words && id ? turn(words, true) : null;
    finals = []; id = null; startSec = null;
    return t;
  };
  return r => {
    if (r.type === 'UtteranceEnd') return close();
    if (r.type !== 'Results') return null;
    const text = ((((r.channel || {}).alternatives || [])[0] || {}).transcript || '').trim();
    if (text) {
      id = id || turnId();
      if (startSec === null) startSec = r.start || 0;
      endSec = (r.start || 0) + (r.duration || 0);
    }
    if (r.is_final && text) finals.push(text);
    if (r.is_final && r.speech_final) return close();
    if (!id) return null;
    const words = [...finals, ...(r.is_final ? [] : [text])].filter(Boolean).join(' ');
    return words ? turn(words, false) : null;
  };
}

function listen(stream, speaker) {
  const side = speaker === 'prospect' ? 'tab' : 'mic';
  let attempts = 0;
  let wanted = true;
  let rec = null;
  const connect = () => {
    if (!call || !wanted) return;
    const host = call.stt.host || 'api.deepgram.com';
    const url = 'wss://' + host + '/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true';
    const ws = new WebSocket(url, ['bearer', call.stt.token]);
    const push = assembler(speaker, Date.now() - call.startedAt);
    const entry = { ws, stop: () => { wanted = false; try { rec && rec.stop(); } catch (_) {} try { ws.send(JSON.stringify({ type: 'CloseStream' })); ws.close(); } catch (_) {} } };
    sockets.push(entry);
    ws.onopen = () => {
      attempts = 0;
      status(side, { state: 'on' });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: mime });
      rec.ondataavailable = e => { if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
      rec.start(100);
    };
    ws.onmessage = m => {
      let r;
      try { r = JSON.parse(String(m.data)); } catch (_) { return; }
      const t = push(r);
      if (t) postTurn(t);
    };
    ws.onclose = e => {
      try { rec && rec.stop(); } catch (_) {}
      rec = null;
      if (!wanted || !call) return;
      if (attempts >= 5) { status(side, { state: 'error', message: 'Transcription stopped: lost the connection to Deepgram.' }); return; }
      attempts++;
      // The token may have expired: ask for a fresh one, then reconnect.
      if (e.code === 1008 || (e.code >= 4000 && e.code < 4100)) send({ type: 'stt-refresh' });
      setTimeout(connect, Math.min(8000, 400 * 2 ** attempts));
    };
  };
  connect();
}

/* ── capture ── */

async function start(m) {
  stop();
  call = { callId: m.callId, startedAt: m.startedAt, server: m.server, token: m.token, stt: m.stt };
  ctx = new AudioContext();
  if (m.tabStream) {
    try {
      const tab = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.tabStream } }, video: false });
      streams.push(tab);
      // Capturing a tab mutes it; play it back so the rep still hears the prospect.
      ctx.createMediaStreamSource(tab).connect(ctx.destination);
      listen(tab, 'prospect');
    } catch (e) {
      status('tab', { state: 'error', message: "Couldn't open the call tab's audio: " + (e.message || e) });
    }
  }
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    streams.push(mic);
    listen(mic, 'rep');
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    status('mic', { state: denied ? 'denied' : 'error', message: denied ? 'Microphone blocked: use "Allow microphone" in the panel.' : String(e.message || e) });
  }
}

function stop() {
  for (const s of sockets.splice(0)) s.stop();
  for (const s of streams.splice(0)) for (const t of s.getTracks()) t.stop();
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
  call = null;
  lastInterim.clear();
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || m.target !== 'offscreen') return false;
  if (m.type === 'start') start(m);
  if (m.type === 'stop') stop();
  if (m.type === 'stt' && call) call.stt = m.stt;
  reply({ ok: true });
  return false;
});
