// Mubit: the OpenAI-compatible gateway Steward's plans and lessons go through, used here
// for the debrief conversation. The key stays on the server.
//
//   GET  /api/mubit           { configured, model, base }
//   POST /api/mubit/debrief   { system, messages: [{role, content}] } -> { text, id, ms, usage }

import { env } from "../server/env";
import { fail, json, readJson } from "../server/http";
import type { ServerService } from "../server/types";

const baseUrl = () => env("MUBIT_BASE_URL") || "https://api.mubit.ai/openai/v1";
const model = () => env("STEWARD_DEBRIEF_MODEL") || env("STEWARD_MODEL") || "gpt-6-luna";
const MAX_CHARS = 200_000;

async function debrief(req: Request) {
  const key = env("MUBIT_API_KEY");
  if (!key) return fail(503, "no_key", "Set MUBIT_API_KEY in the repo's .env.");
  const body = await readJson<{ system?: unknown; messages?: unknown }>(req);
  if (!body) return fail(400, "bad_request", "Send JSON.");
  const system = typeof body.system === "string" ? body.system : "";
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((m): m is { role: "user" | "assistant"; content: string } =>
        !!m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length > 0)
    : [];
  const size = system.length + messages.reduce((a, m) => a + m.content.length, 0);
  if (!messages.length || messages[messages.length - 1].role !== "user") return fail(400, "bad_request", "The last message must be the operator's question.");
  if (size > MAX_CHARS) return fail(413, "too_large", "The episode is too large to send.");
  const start = Date.now();
  try {
    const r = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model(), messages: [{ role: "system", content: system }, ...messages] }),
      signal: req.signal,
    });
    if (!r.ok) return fail(502, "upstream", (await r.text()).slice(0, 300), { status: r.status });
    const j = await r.json();
    return json({ text: String(j?.choices?.[0]?.message?.content ?? ""), id: j?.id ?? null, ms: Date.now() - start, usage: j?.usage ?? null, model: j?.model ?? model() });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return new Response(null, { status: 499 });
    return fail(502, "unreachable", (err as Error)?.message || "Mubit could not be reached.");
  }
}

export const service: ServerService = {
  id: "mubit",
  label: "Mubit gateway",
  about: "Plans, lessons and (without Sapling) safety checks go through Mubit's OpenAI-compatible gateway; the console uses it for debriefs.",
  env: [
    { key: "MUBIT_API_KEY", about: "Mubit key. Needed for practice runs and debriefs.", secret: true },
    { key: "MUBIT_BASE_URL", about: "Gateway URL (default https://api.mubit.ai/openai/v1)." },
    { key: "STEWARD_MODEL", about: "Model Steward asks for (default gpt-6-luna)." },
    { key: "STEWARD_DEBRIEF_MODEL", about: "Model for debriefs (default STEWARD_MODEL)." },
  ],
  routes: [
    { method: "GET", path: "", handle: () => json({ configured: !!env("MUBIT_API_KEY"), model: model(), base: new URL(baseUrl()).host }) },
    { method: "POST", path: "debrief", handle: debrief },
  ],
  async health() {
    // No network call here: health checks must never spend anything.
    return env("MUBIT_API_KEY")
      ? { status: "ok", summary: `Key set · model ${model()} · ${new URL(baseUrl()).host}`, detail: { model: model() } }
      : { status: "off", summary: "MUBIT_API_KEY isn't set: practice runs and debriefs are off." };
  },
};
