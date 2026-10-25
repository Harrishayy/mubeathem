import { api } from "../http";
import type { SafetyReport, SafetyResult } from "./types";

export const getSafety = (signal?: AbortSignal) => api<SafetyResult>("safety", { signal });
export const getSafetyReport = (run: string) => api<SafetyReport>(`safety/${encodeURIComponent(run)}/report`);
export const safetyVideoUrl = (run: string, id: string, variant: "baseline" | "protected", layout?: "stacked") =>
  `/api/safety/${encodeURIComponent(run)}/${encodeURIComponent(id)}/${variant}/video${layout === "stacked" ? "?layout=stacked" : ""}`;
export const safetyReportUrl = (run: string) => `/api/safety/${encodeURIComponent(run)}/report`;
