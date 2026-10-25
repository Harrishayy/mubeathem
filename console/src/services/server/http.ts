// Response helpers every service uses, so errors look the same everywhere:
// { code, message } with a matching status.

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json({ code, message, ...extra }, status);

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

/** Serve a file with byte-range support, which browsers need to seek inside a video. */
export function sendFile(req: Request, file: string, type: string): Response {
  const size = statSync(file).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (!m) {
    headers["Content-Length"] = String(size);
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
  }
  let start: number, end: number;
  if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  else { start = Math.max(0, size - Number(m[2] || 0)); end = size - 1; }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers });
}
