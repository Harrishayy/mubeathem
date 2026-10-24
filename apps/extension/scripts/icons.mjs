// Renders Sprout (the Cue mascot, from @cue/ui's Sprout.tsx, Honey palette) to the extension's PNG
// icons. Run with `pnpm --filter @cue/extension icons`; the PNGs are committed under public/icon.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'icon');
mkdirSync(out, { recursive: true });

const C = { leaf: '#5c8a52', leaf2: '#8db27a', vein: '#d9ead0', stem: '#4a6f45', pod: '#efbd73', face: '#2a1c05', cheek: '#f29f7d', ground: '#f8f5ee' };

function sprout(small) {
  // A cream disc behind the seedling so it reads on dark and light toolbars alike.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="23.5" fill="${C.ground}"/>
  <g transform="translate(24 25) scale(${small ? 1.02 : 0.94}) translate(-24 -25)">
    <path d="M24 31.5C24 26 24.6 21.5 24 16" fill="none" stroke="${C.stem}" stroke-width="${small ? 3 : 2.3}" stroke-linecap="round"/>
    <path d="M24 22.5C18.6 23 13.2 19.8 11.6 12.6 18.4 11.6 23 15.8 24 22.5Z" fill="${C.leaf}"/>
    ${small ? '' : `<path d="M23.4 21.8C20 18.8 17 16.3 13.9 13.9" fill="none" stroke="${C.vein}" stroke-width="0.9" stroke-linecap="round"/>`}
    <path d="M24 18.2C25.1 11.6 30.2 7 37.4 7.6 36.8 14.7 31.2 18.8 24 18.2Z" fill="${C.leaf2}"/>
    ${small ? '' : `<path d="M24.6 17.6C28 14.6 31.2 11.6 35.3 9.2" fill="none" stroke="${C.vein}" stroke-width="0.9" stroke-linecap="round"/>`}
    <path d="M8.6 30.6h30.8a1.4 1.4 0 0 1 1.4 1.6C40 39.8 33.4 45.2 24 45.2S8 39.8 7.2 32.2a1.4 1.4 0 0 1 1.4-1.6Z" fill="${C.pod}"/>
    ${small ? '' : `<circle cx="15.2" cy="38.6" r="1.7" fill="${C.cheek}" opacity="0.55"/><circle cx="32.8" cy="38.6" r="1.7" fill="${C.cheek}" opacity="0.55"/>`}
    <circle cx="19.3" cy="36.2" r="${small ? 2.5 : 1.9}" fill="${C.face}"/>
    <circle cx="28.7" cy="36.2" r="${small ? 2.5 : 1.9}" fill="${C.face}"/>
    ${small ? '' : `<path d="M22 39.4q2 1.7 4 0" fill="none" stroke="${C.face}" stroke-width="1.4" stroke-linecap="round"/>`}
  </g>
</svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  const svg = sprout(size <= 32);
  if (size === 128) writeFileSync(join(out, 'sprout.svg'), svg);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(out, `${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log(`icons written to ${out}`);
