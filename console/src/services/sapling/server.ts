// Sapling: Banyan Sapling, the safety verifier sapling/serve.py serves (usually on the DGX,
// tunnelled to SAPLING_URL). The console checks it is up and can send it one check.
//
//   GET  /api/sapling          { configured, url, up, weights }
//   POST /api/sapling/verify   { policy, evidence, claim } -> Sapling's answer, plus ms

import { env } from "../server/env";
import { fail, json, readJson } from "../server/http";
import type { ServerService } from "../server/types";
import type { SaplingCheck } from "../types";

const url = () => env("SAPLING_URL")?.replace(/\/+$/, "") || null;

async function probe(): Promise<{ up: boolean; weights?: string; error?: string }> {
  const u = url();
  if (!u) return { up: false, error: "SAPLING_URL isn't set." };
  try {
    const r = await fetch(`${u}/health`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!r.ok) return { up: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    return { up: !!j.ok, weights: j.weights_sha256 || undefined };
  } catch (e) { return { up: false, error: (e as Error).message }; }
}

export const service: ServerService = {
  id: "sapling",
  label: "Banyan Sapling",
  about: "The calibrated safety verifier. Takes run their checks on it; the console can probe it and send one check by hand.",
  env: [{ key: "SAPLING_URL", about: "Where sapling/serve.py answers, e.g. http://127.0.0.1:8765 through an SSH tunnel to the DGX." }],
  routes: [
    { method: "GET", path: "", handle: async () => { const p = await probe(); return json({ configured: !!url(), url: url(), ...p }); } },
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
          const r = await fetch(`${u}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: b.policy, evidence: b.evidence, claim: b.claim }), signal: AbortSignal.timeout(30000) });
          const j = await r.json().catch(() => ({}));
          return r.ok ? json({ ...j, ms: Date.now() - start }) : fail(502, "upstream", String(j.error || `HTTP ${r.status}`));
        } catch (e) { return fail(502, "unreachable", (e as Error).message); }
      },
    },
  ],
  async health() {
    if (!url()) return { status: "off", summary: "SAPLING_URL isn't set. Takes then use the stand-in check through Mubit; offline runs use the scripted one." };
    const p = await probe();
    return p.up
      ? { status: "ok", summary: `Up at ${url()}${p.weights ? ` · weights ${p.weights.slice(0, 12)}…` : ""}`, detail: { url: url(), weights: p.weights } }
      : { status: "error", summary: `Not answering at ${url()}: ${p.error}`, detail: { url: url() } };
  },
};
