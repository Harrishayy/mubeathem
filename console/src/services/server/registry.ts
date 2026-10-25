// THE SERVICE REGISTRY (server side). One line per service; each is served at /api/<id>/.
//
//   Plug a service out:  delete its line (and its client.ts users), or list its id in
//                        STEWARD_SERVICES_OFF to switch it off without a code change.
//   Plug one in:         create src/services/<id>/server.ts exporting `service`, add it here.
//
// How to add one: "A new backend service" in the repo's CLAUDE.md.

import type { ServerService } from "./types";
import { service as runs } from "../runs/server";
import { service as live } from "../live/server";
import { service as lessons } from "../lessons/server";
import { service as mubit } from "../mubit/server";
import { service as sapling } from "../sapling/server";
import { service as practice } from "../practice/server";
import { service as safety } from "../safety/server";

export const SERVER_SERVICES: ServerService[] = [runs, live, lessons, mubit, sapling, practice, safety];
