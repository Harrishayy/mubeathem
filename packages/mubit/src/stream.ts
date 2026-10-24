/**
 * Streaming helpers for the live path: read a server-sent-event body line by line, and pull finished
 * top-level string fields out of a JSON object that is still being written.
 */

/** Calls `onData` with each `data:` payload of an SSE body, in order. Resolves when the body ends. */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  const flush = () => {
    if (data.length) onData(data.join('\n'));
    data = [];
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') flush();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  buf += decoder.decode();
  if (buf.startsWith('data:')) data.push(buf.slice(5).replace(/^ /, ''));
  flush();
}

/**
 * The top-level string fields of a partial JSON object that are already complete, e.g.
 * `{"meaning":"busy","say":"Fair en` → `{ meaning: 'busy' }`. Nested objects and arrays are skipped,
 * so a nested key never shadows a top-level one.
 */
export function completedFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = text.indexOf('{');
  if (i < 0) return out;
  i++;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  /** Reads a JSON string starting at the opening quote; null if it isn't closed yet. */
  const readString = (): string | null => {
    const start = i;
    i++;
    while (i < n) {
      const c = text[i]!;
      if (c === '\\') i += 2;
      else if (c === '"') {
        i++;
        try {
          return JSON.parse(text.slice(start, i)) as string;
        } catch {
          return null;
        }
      } else i++;
    }
    return null;
  };
  /** Skips a nested value (object, array, number, literal); false if it isn't closed yet. */
  const skipValue = (): boolean => {
    const c = text[i];
    if (c === '{' || c === '[') {
      let depth = 0;
      while (i < n) {
        const ch = text[i]!;
        if (ch === '"') {
          if (readString() === null) return false;
          continue;
        }
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            i++;
            return true;
          }
        }
        i++;
      }
      return false;
    }
    while (i < n && !/[,}\s]/.test(text[i]!)) i++;
    return i < n;
  };
  for (;;) {
    skipWs();
    if (text[i] !== '"') return out;
    const key = readString();
    if (key === null) return out;
    skipWs();
    if (text[i] !== ':') return out;
    i++;
    skipWs();
    if (i >= n) return out;
    if (text[i] === '"') {
      const v = readString();
      if (v === null) return out;
      out[key] = v;
    } else if (!skipValue()) return out;
    skipWs();
    if (text[i] === ',') i++;
    else return out;
  }
}
