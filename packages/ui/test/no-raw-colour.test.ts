/** Components and component CSS use tokens only (CLAUDE.md "UI" rule). Raw values live in src/tokens. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '../src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const RAW = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(white|black)\b(?![-\w])/;

describe('no raw colours outside the token files', () => {
  const targets = files(src).filter((f) => !f.includes('/tokens/') && !f.includes('/fixtures/') && /\.(css|tsx?)$/.test(f));
  it.each(targets.map((f) => relative(src, f)))('%s', (rel) => {
    const lines = readFileSync(join(src, rel), 'utf8').split('\n');
    const hits = lines
      .map((l, i) => [i + 1, l.replace(/\/\*.*?\*\/|\/\/.*$/g, '')] as const)
      .filter(([, l]) => RAW.test(l) && !/data-|aria-|stroke-dasharray|font|mask/.test(l.match(RAW)![0]));
    expect(hits.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});
