import { CaptureController } from '../../src/capture/controller';
import type { OffscreenCommand, OffscreenEvent } from '../../src/messages';

/** Offscreen document: audio capture and transcription (MV3 service workers have no DOM or media). */
const send = (e: OffscreenEvent) => {
  chrome.runtime.sendMessage(e).catch(() => {
    /* the worker is restarting; the next level tick wakes it */
  });
};

const capture = new CaptureController(send);

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'capture.start') {
    capture.start(msg).then(
      () => sendResponse({ ok: true, data: null }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  }
  if (msg.type === 'capture.speaker') capture.setMicSpeaker(msg.micSpeaker);
  if (msg.type === 'capture.stop') capture.stop();
  sendResponse({ ok: true, data: null });
  return false;
});

send({ type: 'offscreen.ready' });
