// Sapling: Banyan Sapling, the safety verifier sapling/serve.py serves (usually on the DGX,
// tunnelled to SAPLING_URL) or deploy/modal/sapling.py hosts. The console checks it is up
// and can send it one check. The URL never reaches the browser, only where it is.
//
//   GET  /api/sapling          { configured, where, up, weights }
//   POST /api/sapling/verify   { policy, evidence, claim } -> Sapling's answer, plus ms

import { env } from "../server/env";
import { fail, json, readJson } from "../server/http";
import type { ServerService } from "../server/types";
import type { SaplingCheck } from "../types";

const url = () => env("SAPLING_URL")?.replace(/\/+$/, "") || null;
/** SAPLING_TOKEN as a bearer token, as steward/sapling.py sends it. The Modal deployment requires it. */
const auth = (): Record<string, string> => { const t = env("SAPLING_TOKEN"); return t ? { Authorization: `Bearer ${t}` } : {}; };
/** A cold Modal GPU loads 46 GB before its first answer (about 43 s), as steward/sapling.py allows for. */
const VERIFY_TIMEOUT_MS = 120_000;
/** /health on Modal wakes a (cheap, billed) CPU container, so its answer is reused for a while. */
const HEALTH_TTL_MS = 5 * 60_000;

/** Where Sapling answers, for display: a local host and port, or just the kind of host. */
function where(): string | null {
  const u = url();
  if (!u) return null;
  try {
    const { host, hostname } = new URL(u);
    if (/^(localhost|127\.[\d.]+|\[::1\])$/.test(hostname)) return host;
    return hostname.endsWith(".modal.run") ? "Modal (hosted)" : "a remote host";
  } catch { return "an unreadable SAPLING_URL"; }
}

type Probe = { up: boolean; weights?: string; error?: string };
const g = globalThis as unknown as { __stewardSaplingProbe?: { url: string; at: number; probe: Probe } };

async function probe(): Promise<Probe> {
  const u = url();
  if (!u) return { up: false, error: "SAPLING_URL isn't set." };
  const hit = g.__stewardSaplingProbe;
  if (hit && hit.url === u && Date.now() - hit.at < HEALTH_TTL_MS) return hit.probe;
  let p: Probe;
  try {
    const r = await fetch(`${u}/health`, { headers: auth(), signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!r.ok) p = { up: false, error: `HTTP ${r.status}` };
    else { const j = await r.json(); p = { up: !!j.ok, weights: j.weights_sha256 || undefined }; }
  } catch (e) { p = { up: false, error: (e as Error).message }; }
  // Only a healthy answer is reused, so a restarted server shows up on the next look.
  if (p.up) g.__stewardSaplingProbe = { url: u, at: Date.now(), probe: p };
  return p;
}

export const service: ServerService = {
  id: "sapling",
  label: "Banyan Sapling",
  about: "The calibrated safety verifier. Takes run their checks on it; the console can probe it and send one check by hand.",
  env: [
    { key: "SAPLING_URL", about: "Where Sapling answers: sapling/serve.py through an SSH tunnel (http://127.0.0.1:8765), or the Modal deployment." },
    { key: "SAPLING_TOKEN", about: "Bearer token sent on every Sapling request. The Modal deployment refuses /verify without it.", secret: true },
  ],
  routes: [
    { method: "GET", path: "", handle: async () => { const p = await probe(); return json({ configured: !!url(), where: where(), ...p }); } },
    {
      method: "POST", path: "verify",
      async handle(req) {
        const u = url();
        if (!u) return fail(503, "not_configured", "Set SAPLING_URL to reach Sapling.");
        const b = await readJson<SaplingCheck>(req);
        if (!b || !["policy", "evidence", "claim"].every((k) => typeof (b as unknown as Record<string, unknown>)[k] === "string" && (b as unknown as Record<string, string>)[k].trim()))
          return fail(400, "bad_request", "policy, evidence and claim must be nonempty strings.");
        const start = Date.now();
        try {
          const r = await fetch(`${u}/verify`, { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify({ policy: b.policy, evidence: b.evidence, claim: b.claim }), signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
          const j = await r.json().catch(() => ({}));
          if (r.status === 401) return fail(502, "unauthorized", "Sapling refused the check: set SAPLING_TOKEN to the deployment's token.");
          return r.ok ? json({ ...j, ms: Date.now() - start }) : fail(502, "upstream", String(j.error || j.detail || `HTTP ${r.status}`));
        } catch (e) { return fail(502, "unreachable", (e as Error).message); }
      },
    },
  ],
  async health() {
    if (!url()) return { status: "off", summary: "SAPLING_URL isn't set, so safety checks go through Mubit instead." };
    const p = await probe();
    return p.up
      ? { status: "ok", summary: `Up on ${where()}${p.weights ? ` · weights ${p.weights.slice(0, 12)}…` : ""}`, detail: { where: where(), weights: p.weights } }
      : { status: "error", summary: `Not answering on ${where()}: ${p.error}`, detail: { where: where() } };
  },
};
