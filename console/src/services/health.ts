// The Services tab and the source picker read this: every service's health in one call.

import { api } from "./http";
import type { HealthReport } from "./types";

export const getHealth = () => api<HealthReport>("health");
