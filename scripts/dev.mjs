#!/usr/bin/env node
// `pnpm dev`: the server on :8787 and the web app on :5173, with prefixed output.
// Ctrl+C stops both. Pass --ext to also run the extension in WXT dev mode.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'server', color: 33, args: ['--filter', '@cue/server', 'dev'] },
  { name: 'web', color: 36, args: ['--filter', '@cue/web', 'dev'] },
];
if (process.argv.includes('--ext')) procs.push({ name: 'ext', color: 35, args: ['--filter', '@cue/extension', 'dev'] });

const children = procs.map(({ name, color, args }) => {
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = `\x1b[${color}m${name.padEnd(6)}\x1b[0m│ `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(tag + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited (${code ?? 'signal'})\n`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
