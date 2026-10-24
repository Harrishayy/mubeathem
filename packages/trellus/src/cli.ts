/**
 * `pnpm --filter @cue/trellus check` (or `pnpm trellus:check`): verify a Trellus key from the
 * server environment by calling /visible and /bootstrap, and print a redacted summary.
 * `--fixtures` runs the same check against the offline fake API.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTrellusClient, type FetchLike } from './client';
import { loadTrellusConfig } from './config';
import { learnDispositions } from './dispositions';
import { TrellusError } from './errors';
import { createFakeTrellusFetch, FIXTURE_API_KEY } from './fixtures/fake-fetch';

const out = (line = '') => process.stdout.write(`${line}\n`);

export function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return `${user[0]}***@${domain}`;
}

export async function runCheck(env: Record<string, string | undefined>, opts: { fetch?: FetchLike; print?: (line: string) => void } = {}): Promise<number> {
  const print = opts.print ?? out;
  const cfg = loadTrellusConfig(env);
  if (!cfg.apiKey) {
    print('Trellus: no key set, so Cue runs native (its own call record and dispositions).');
    print('To connect Trellus: in Trellus open Settings → Integrations → API, copy your key, and set');
    print('TRELLUS_API_KEY=… in the repo-root .env (server only), or paste it in Cue settings.');
    return 0;
  }
  const client = createTrellusClient({ apiKey: cfg.apiKey, teamId: cfg.teamId, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  print(`Trellus: key set (${cfg.apiKey.length} chars)${cfg.teamId ? `, team ${cfg.teamId}` : ''}, polling every ${cfg.pollSeconds || 'never'}${cfg.pollSeconds ? ' s' : ''}`);
  try {
    const dir = await client.visible();
    print(`  /visible    ok · team: ${dir.team ? `${dir.team.team ?? dir.team.team_id}` : '(not a whole-team reader)'} · ${dir.users.length} readable users · ${dir.groups.length} groups`);
    for (const u of dir.users.slice(0, 10)) {
      const email = dir.user_id_to_email[u.user_id];
      print(`    ${u.user_id}  ${u.user_name ?? ''}${email ? `  ${redactEmail(email)}` : ''}`);
    }
    const learned = learnDispositions(await client.bootstrap());
    print(`  /bootstrap  ok · ${learned.length} dispositions`);
    for (const d of learned) print(`    ${d.raw.padEnd(32)} → ${d.outcome}${d.via === 'default' ? '' : ` (${d.via})`}`);
    const unmapped = learned.filter((d) => d.via === 'unmapped');
    if (unmapped.length) print(`  ${unmapped.length} disposition(s) map to "unknown"; set them in Cue settings.`);
    return 0;
  } catch (err) {
    if (err instanceof TrellusError) {
      print(`  failed: ${err.name} (${err.status ?? 'network'}) on ${err.endpoint} at ${err.at}: ${err.body.slice(0, 200)}`);
      if (err.code === 'unauthorized') print('  The key is invalid or the account is inactive. Copy it again from Settings → Integrations → API.');
    } else {
      print(`  failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 1;
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...flags] = argv;
  if (command !== 'check') {
    out('usage: tsx src/cli.ts check [--fixtures]');
    process.exitCode = 2;
    return;
  }
  if (flags.includes('--fixtures')) {
    process.exitCode = await runCheck({ TRELLUS_API_KEY: FIXTURE_API_KEY }, { fetch: createFakeTrellusFetch() });
    return;
  }
  const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.exitCode = await runCheck(process.env);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main(process.argv.slice(2));
