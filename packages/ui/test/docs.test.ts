/** docs/design/index.html embeds the real CSS; this fails when it falls behind the source. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleCss } from '../scripts/build-docs';

describe('docs/design/index.html', () => {
  it('embeds the current styles (run `pnpm --filter @cue/ui docs` if this fails)', () => {
    const html = readFileSync(join(__dirname, '../../../docs/design/index.html'), 'utf8');
    expect(html.includes(bundleCss()), 'docs page is stale').toBe(true);
  });
});
