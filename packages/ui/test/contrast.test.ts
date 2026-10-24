/**
 * Parses the token CSS and asserts every text/background pair the components use clears WCAG AA
 * (4.5:1), graphics clear 3:1, and Signal's line text clears AAA (7:1). Translucent Night glass is
 * composited over its own --bg and over a white page, since it floats over HubSpot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, type RGBA } from '../scripts/color.mjs';
import { MOMENT_FAMILIES } from '@cue/core';

const dir = join(__dirname, '../src/tokens');

type Vars = Record<string, string>;

function blocks(file: string): { selector: string; vars: Vars }[] {
  const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; vars: Vars }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const vars: Vars = {};
    for (const d of m[2]!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]!] = d[2]!.trim();
    out.push({ selector: m[1]!.trim(), vars });
  }
  return out;
}

function contexts(): { name: string; vars: Vars; backdrops: RGBA[]; aaa: boolean }[] {
  const res: { name: string; vars: Vars; backdrops: RGBA[]; aaa: boolean }[] = [];
  for (const [file, name] of [['honey.css', 'honey'], ['night.css', 'night'], ['signal.css', 'signal']] as const) {
    const bs = blocks(file).filter((b) => b.selector.includes('data-dir'));
    const light = bs.find((b) => !b.selector.includes("data-theme='dark'"))!;
    const dark = bs.find((b) => b.selector.includes("data-theme='dark'"));
    const white: RGBA = [255, 255, 255, 1];
    const bgOf = (v: Vars) => parseColor(v.bg!)!;
    const glassy = name === 'night';
    res.push({ name: dark ? `${name}-light` : name, vars: light.vars, backdrops: glassy ? [bgOf(light.vars), white] : [bgOf(light.vars)], aaa: name === 'signal' });
    if (dark) {
      const vars = { ...light.vars, ...dark.vars };
      res.push({ name: `${name}-dark`, vars, backdrops: [bgOf(vars)], aaa: name === 'signal' });
    }
  }
  return res;
}

function color(vars: Vars, key: string): RGBA {
  let v = vars[key];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = vars[v.slice(6, -1)];
  const c = v ? parseColor(v) : null;
  if (!c) throw new Error(`--${key} is not a parseable colour: ${String(vars[key])}`);
  return c;
}

describe.each(contexts())('$name tokens', ({ vars, backdrops, aaa }) => {
  for (const [i, page] of backdrops.entries()) {
    const label = i === 0 ? 'on its own ground' : 'over a white page';
    const surface = over(color(vars, 'surface'), page);
    const surface2 = over(color(vars, 'surface-2'), surface);
    const bg = over(color(vars, 'bg'), page);
    const pair = (fg: string, ground: RGBA) => contrast(over(color(vars, fg), ground), ground);

    it(`body text clears AA ${label}`, () => {
      for (const ink of ['ink', 'ink-2', 'ink-3']) {
        for (const [gname, g] of [['surface', surface], ['surface-2', surface2], ['bg', bg]] as const) {
          expect(pair(ink, g), `${ink} on ${gname}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`line text clears ${aaa ? 'AAA' : 'AA'} ${label}`, () => {
      expect(pair('ink', surface)).toBeGreaterThanOrEqual(aaa ? 7 : 4.5);
    });

    it(`accent pairs clear AA ${label}`, () => {
      expect(contrast(color(vars, 'accent-ink'), over(color(vars, 'accent'), surface)), 'accent-ink on accent').toBeGreaterThanOrEqual(4.5);
      expect(pair('accent-text', surface), 'accent-text on surface').toBeGreaterThanOrEqual(4.5);
      expect(pair('accent-text', over(color(vars, 'accent-soft'), surface)), 'accent-text on accent-soft').toBeGreaterThanOrEqual(4.5);
      expect(pair('focus', bg), 'focus ring on bg').toBeGreaterThanOrEqual(3);
      expect(pair('focus', surface), 'focus ring on surface').toBeGreaterThanOrEqual(3);
    });

    it(`dashboard chrome clears AA ${label}`, () => {
      const band = over(color(vars, 'band'), page);
      for (const fg of ['band-ink', 'band-ink-2', 'band-ok', 'band-warn']) expect(pair(fg, band), `${fg} on band`).toBeGreaterThanOrEqual(4.5);
      const head = over(color(vars, 'pane-head'), surface);
      for (const fg of ['ink', 'ink-2', 'ink-3']) expect(pair(fg, head), `${fg} on pane-head`).toBeGreaterThanOrEqual(4.5);
      const rowOn = over(color(vars, 'row-on'), surface);
      for (const fg of ['ink', 'ink-2']) expect(pair(fg, rowOn), `${fg} on row-on`).toBeGreaterThanOrEqual(4.5);
      // The active tab is the page ground: its ink must read there too.
      expect(pair('ink', bg), 'ink on the active tab').toBeGreaterThanOrEqual(4.5);
      expect(pair('pane-line', surface), 'pane rule on surface').toBeGreaterThanOrEqual(1.25);
    });

    it(`status colours clear AA ${label}`, () => {
      for (const s of ['ok', 'warn', 'bad', 'info']) {
        expect(pair(s, surface), `${s} on surface`).toBeGreaterThanOrEqual(4.5);
        expect(pair(s, over(color(vars, `${s}-soft`), surface)), `${s} on ${s}-soft`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`every moment family is legible ${label}`, () => {
      for (const f of MOMENT_FAMILIES) {
        const soft = over(color(vars, `moment-${f}-soft`), surface);
        expect(pair(`moment-${f}-ink`, soft), `${f} ink on soft`).toBeGreaterThanOrEqual(aaa ? 7 : 4.5);
        expect(pair(`moment-${f}-ink`, surface), `${f} ink on surface`).toBeGreaterThanOrEqual(aaa ? 7 : 4.5);
        expect(pair(`moment-${f}`, surface), `${f} accent on surface (graphic)`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
