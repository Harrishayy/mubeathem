// Colour maths shared by the moment generator and the contrast test.
// OKLCH -> sRGB (with chroma reduction into gamut), parsing of the colour forms our tokens use,
// alpha compositing and WCAG 2 contrast.

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH -> [r,g,b] 0..255, reducing chroma until the colour is inside sRGB. */
export function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  let c = C;
  for (let i = 0; i < 60; i++) {
    const lin = oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005) || c <= 0) {
      return lin.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255));
    }
    c -= C / 60;
  }
  return [0, 0, 0];
}

export const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax). Returns [r,g,b,a] or null. */
export function parseColor(input) {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), a];
  }
  return null;
}

/** Composites a colour with alpha over an opaque backdrop. */
export function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

export function luminance([r, g, b]) {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
