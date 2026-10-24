import type { TrellusClient } from './client';
import type { SessionListRequest } from './requests';

export interface WindowedListResult {
  rows: unknown[][];
  /** True when some sub-window still hit the row cap at the smallest split: the list may be incomplete. */
  capped: boolean;
  requests: number;
}

/**
 * session-list-v6 has no cursor: it returns the newest `limit` rows. When a window fills the cap,
 * split it into halves and merge, de-duplicating by `session_id` (which must be selected).
 * Rows come back newest first. Never present `capped: true` as a complete export.
 */
export async function listSessionsSplitting(
  client: Pick<TrellusClient, 'sessionList'>,
  req: SessionListRequest & { end: number },
  opts: { minWindowMicros?: number; maxRequests?: number } = {},
): Promise<WindowedListResult> {
  const idIdx = req.select.indexOf('session_id');
  const startedIdx = req.select.indexOf('started_at');
  if (idIdx < 0) throw new Error('listSessionsSplitting: select must include session_id');
  const limit = req.limit ?? 1000;
  const minWindow = opts.minWindowMicros ?? 60 * 1_000_000;
  const maxRequests = opts.maxRequests ?? 50;
  const seen = new Map<string, unknown[]>();
  let capped = false;
  let requests = 0;

  const stack: Array<[number, number]> = [[req.start, req.end]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (requests >= maxRequests) {
      capped = true;
      break;
    }
    requests++;
    const rows = await client.sessionList({ ...req, start, end, limit });
    for (const row of rows) {
      const id = String(row[idIdx] ?? '');
      if (id && !seen.has(id)) seen.set(id, row);
    }
    if (rows.length >= limit) {
      if (end - start <= minWindow) capped = true;
      else {
        const mid = start + Math.floor((end - start) / 2);
        stack.push([start, mid], [mid, end]);
      }
    }
  }

  const rows = [...seen.values()];
  if (startedIdx >= 0) rows.sort((a, b) => Number(b[startedIdx] ?? 0) - Number(a[startedIdx] ?? 0));
  return { rows, capped, requests };
}
