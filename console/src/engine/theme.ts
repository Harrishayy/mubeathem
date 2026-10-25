// Theme colors for canvas drawing, read from the CSS tokens so both themes match.

export const C: Record<string, string> = {};

export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bg", "s1", "s2", "s3", "line", "line-2", "fg", "muted", "subtle", "ok", "fail", "hold"]) {
    C[k.replace("-", "")] = cs.getPropertyValue("--" + k).trim() || "#888888";
  }
}

export function alpha(hex: string, a: number) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function watchTheme(cb: () => void) {
  const run = () => { readColors(); cb(); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", run);
  const mo = new MutationObserver(run);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => { mq.removeEventListener("change", run); mo.disconnect(); };
}
