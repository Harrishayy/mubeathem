// Opened in a tab once: the offscreen document can't show Chrome's permission prompt itself.
const msg = document.getElementById('msg');
navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
  for (const t of s.getTracks()) t.stop();
  msg.textContent = 'Done. You can close this tab.';
  chrome.runtime.sendMessage({ type: 'mic-granted' }).catch(() => {});
  setTimeout(() => window.close(), 900);
}, e => {
  msg.textContent = 'Chrome blocked the microphone (' + (e.name || e) + '). Allow it from the address bar, then reload this page.';
});
