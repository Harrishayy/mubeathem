// The browser side of /api/*: every service's client.ts uses these, so failures read the
// same everywhere. A failed call throws ApiError with the service's { code, message }.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(`/api/${path}`, {
    cache: "no-store", ...rest,
    ...(json !== undefined ? { method: rest.method || "POST", body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers || {}) } } : {}),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body.code || "http_error", body.message || `HTTP ${r.status}`, body);
  return body as T;
}
