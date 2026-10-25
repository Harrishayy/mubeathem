// One route for every service: /api/<service>/<path> goes to the route that service
// declares in its server.ts. /api/health reports every service. Nothing service-specific
// lives here; see src/services/server/registry.ts.

import { SERVER_SERVICES } from "@/services/server/registry";
import { disabledServices, env, readOnly, repoRoot } from "@/services/server/env";
import { fail, json } from "@/services/server/http";
import type { Method, Route } from "@/services/server/types";
import type { HealthReport } from "@/services/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

function match(route: Route, parts: string[]): Record<string, string> | null {
  const pat = route.path ? route.path.split("/") : [];
  if (pat.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    if (pat[i].startsWith(":")) {
      try { params[pat[i].slice(1)] = decodeURIComponent(parts[i]); } catch { return null; }
    } else if (pat[i] !== parts[i]) return null;
  }
  return params;
}

/** POST and DELETE start paid runs, call Mubit or Sapling, or change lesson files. Only this
 *  console's own pages may send them: a browser always sends Origin on these, so another
 *  site can't drive them through an operator's browser. Scripts on this machine send none. */
function refuseWrite(method: Method, req: Request): Response | null {
  if (method === "GET") return null;
  if (readOnly()) return fail(403, "read_only", "This console is read-only (STEWARD_READ_ONLY).");
  const origin = req.headers.get("origin");
  const sameHost = (o: string) => { try { return new URL(o).host === req.headers.get("host"); } catch { return false; } };
  if ((origin && !sameHost(origin)) || req.headers.get("sec-fetch-site") === "cross-site")
    return fail(403, "cross_origin", "Only this console's own pages can make this request.");
  if (method === "POST" && !/^application\/json\b/i.test(req.headers.get("content-type") || ""))
    return fail(415, "json_only", "Send Content-Type: application/json.");
  return null;
}

async function health(): Promise<HealthReport> {
  const off = disabledServices();
  const services = await Promise.all(SERVER_SERVICES.map(async (s) => ({
    id: s.id, label: s.label, about: s.about,
    env: (s.env || []).map((v) => ({ ...v, set: !!env(v.key) })),
    health: off.includes(s.id)
      ? { status: "off" as const, summary: "Switched off by STEWARD_SERVICES_OFF." }
      : await s.health().catch((e: Error) => ({ status: "error" as const, summary: e.message })),
  })));
  return { services, root: repoRoot(), disabled: off };
}

async function dispatch(method: Method, req: Request, ctx: Ctx) {
  const [id, ...rest] = (await ctx.params).path;
  if (id === "health" && !rest.length && method === "GET") return json(await health());
  const svc = SERVER_SERVICES.find((s) => s.id === id);
  if (!svc) return fail(404, "no_service", `No service "${id}". Registered: ${SERVER_SERVICES.map((s) => s.id).join(", ")}.`);
  if (disabledServices().includes(id)) return fail(503, "service_off", `The ${svc.label} service is switched off (STEWARD_SERVICES_OFF).`);
  const refused = refuseWrite(method, req);
  if (refused) return refused;
  for (const route of svc.routes) {
    if (route.method !== method) continue;
    const params = match(route, rest);
    if (params) {
      try { return await route.handle(req, params); }
      catch (e) { console.error(`[steward] ${method} /api/${id}/${rest.join("/")} failed`, e); return fail(500, "internal", (e as Error).message); }
    }
  }
  return fail(404, "no_route", `${svc.label} has no ${method} /api/${[id, ...rest].join("/")}.`);
}

export const GET = (req: Request, ctx: Ctx) => dispatch("GET", req, ctx);
export const POST = (req: Request, ctx: Ctx) => dispatch("POST", req, ctx);
export const DELETE = (req: Request, ctx: Ctx) => dispatch("DELETE", req, ctx);
