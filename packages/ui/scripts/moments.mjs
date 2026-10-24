// Generates the moment colour families for every direction x theme from one OKLCH recipe, nudging
// lightness until each text pair clears its contrast target, and writes them between the
// `moments:start` / `moments:end` markers in src/tokens/*.css.
//
//   node packages/ui/scripts/moments.mjs          # rewrite token files
//   node packages/ui/scripts/moments.mjs --check  # print, don't write
//
// test/contrast.test.ts re-checks the written values, so a hand edit can't slip through.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, hex, oklch, parseColor } from './color.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Hue and peak chroma per family (context.md §4.2: slate, blue, ice, violet, green, gold, amber). */
const FAMILIES = {
  gatekeeper: { h: 252, c: 0.05 },
  opener: { h: 262, c: 0.17 },
  cold: { h: 222, c: 0.11 },
  objection: { h: 300, c: 0.16 },
  signal: { h: 150, c: 0.15 },
  close: { h: 86, c: 0.15 },
  compliance: { h: 58, c: 0.17 },
  neutral: { h: 140, c: 0.014 },
};

/**
 * Per theme: lightness/chroma multipliers for the three roles, the surface the text sits on, and
 * the contrast targets. `dir` decides which token file and selector receive the block.
 */
const THEMES = [
  { file: 'honey.css', key: 'honey-light', surface: '#fcfdf9', base: [0.62, 1], soft: [0.952, 0.26], ink: [0.44, 0.9], inkDir: -1, text: 4.6, art: 3 },
  { file: 'honey.css', key: 'honey-dark', surface: '#18221c', base: [0.76, 0.85], soft: [0.31, 0.34], ink: [0.88, 0.5], inkDir: 1, text: 4.6, art: 3 },
  { file: 'night.css', key: 'night', surface: '#15181a', base: [0.79, 0.95], soft: [0.3, 0.42], ink: [0.9, 0.45], inkDir: 1, text: 4.6, art: 3 },
  { file: 'signal.css', key: 'signal-light', surface: '#ffffff', base: [0.54, 1.1], soft: [0.93, 0.4], ink: [0.36, 1], inkDir: -1, text: 7, art: 3 },
  { file: 'signal.css', key: 'signal-dark', surface: '#0b0d0c', base: [0.8, 1], soft: [0.27, 0.45], ink: [0.93, 0.38], inkDir: 1, text: 7, art: 3 },
];

function family(theme, { h, c }) {
  const rgb = (L, k) => oklch(L, c * k, h);
  const surface = parseColor(theme.surface);
  let [bL] = theme.base;
  let base = rgb(bL, theme.base[1]);
  while (contrast(base, surface) < theme.art) base = rgb((bL += 0.01 * theme.inkDir), theme.base[1]);
  const soft = rgb(theme.soft[0], theme.soft[1]);
  let [iL] = theme.ink;
  let ink = rgb(iL, theme.ink[1]);
  const ok = (x) => contrast(x, soft) >= theme.text && contrast(x, surface) >= theme.text;
  while (!ok(ink) && iL > 0.05 && iL < 0.99) ink = rgb((iL += 0.01 * theme.inkDir), theme.ink[1]);
  return { base: hex(base), soft: hex(soft), ink: hex(ink), cr: contrast(ink, soft).toFixed(2) };
}

function block(theme) {
  const lines = [];
  for (const [name, f] of Object.entries(FAMILIES)) {
    const v = family(theme, f);
    lines.push(`  --moment-${name}: ${v.base}; --moment-${name}-soft: ${v.soft}; --moment-${name}-ink: ${v.ink};`);
  }
  return lines.join('\n');
}

const check = process.argv.includes('--check');
for (const file of new Set(THEMES.map((t) => t.file))) {
  const path = join(here, '../src/tokens', file);
  let css = readFileSync(path, 'utf8');
  for (const theme of THEMES.filter((t) => t.file === file)) {
    const re = new RegExp(`(/\\* moments:start ${theme.key} \\*/\\n)[\\s\\S]*?(\\n\\s*/\\* moments:end \\*/)`);
    if (!re.test(css)) throw new Error(`markers for ${theme.key} missing in ${file}`);
    css = css.replace(re, `$1${block(theme)}$2`);
    if (check) console.log(`/* ${theme.key} */\n${block(theme)}`);
  }
  if (!check) writeFileSync(path, css);
}
