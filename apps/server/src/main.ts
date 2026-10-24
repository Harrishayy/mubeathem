import { serve } from '@hono/node-server';
import { boot } from './boot';

const server = boot();
const { config, cue } = server;
const health = cue.health();

const http = serve({ fetch: server.app.fetch, port: config.port }, (info) => {
  console.log(`[cue] server on http://localhost:${info.port}`);
  console.log(
    `[cue] mubit ${health.mubit.configured ? `configured (${health.mubit.models.fast} / ${health.mubit.models.write})` : 'not configured: rules engine only'} · trellus ${cue.trellus.kind} · sapling ${health.sapling.configured ? 'on' : 'off'} · exa ${health.exa.configured ? 'on' : 'off'} · db ${config.dbPath}`,
  );
});
http.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `[cue] port ${config.port} is in use; set CUE_PORT` : `[cue] http error: ${e.message}`);
  void server.close().finally(() => process.exit(1));
});
server.startBackground();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[cue] ${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  // Close SSE first so http.close() isn't held open by long-lived streams.
  server.streams.closeAll();
  await new Promise<void>((r) => http.close(() => r()));
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
