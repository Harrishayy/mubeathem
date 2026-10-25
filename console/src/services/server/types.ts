// What a service's server half exports. See src/services/CLAUDE.md.

import type { EnvVar, Health } from "../types";

export type Method = "GET" | "POST" | "DELETE";

export interface Route {
  method: Method;
  /** Relative to /api/<service id>/. "" is the service root; ":name" captures one segment. */
  path: string;
  handle(req: Request, params: Record<string, string>): Response | Promise<Response>;
}

export interface ServerService {
  /** Also its URL prefix: /api/<id>/... */
  id: string;
  label: string;
  /** One line for the Services tab. */
  about: string;
  /** Settings it reads, shown on the Services tab (values of secret ones never leave the server). */
  env?: EnvVar[];
  routes: Route[];
  /** Cheap and side-effect free: no paid calls. */
  health(): Promise<Health>;
}
