// Keep company-site clicks inside the side-panel iframe.
// Only runs when this document is framed by the extension (not HubSpot).
(function () {
  const origin = location.ancestorOrigins && location.ancestorOrigins[0];
  if (!origin || !origin.startsWith('chrome-extension://')) return;

  function retarget(root) {
    if (!root || !root.querySelectorAll) return;
    for (const a of root.querySelectorAll('a[target="_top"], a[target="_parent"]'))
      a.setAttribute('target', '_self');
    for (const b of root.querySelectorAll('base[target]'))
      b.removeAttribute('target');
  }

  retarget(document);
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const t = (a.getAttribute('target') || '').toLowerCase();
    if (t === '_top' || t === '_parent') a.setAttribute('target', '_self');
  }, true);

  const mo = new MutationObserver(() => retarget(document));
  const start = () => {
    if (!document.documentElement) return;
    retarget(document);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['target']
    });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
