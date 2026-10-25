import { api } from "../http";
import type { RunsList, TakeDetail } from "../types";

export const listTakes = () => api<RunsList>("runs");
export const getTake = (id: string) => api<TakeDetail>(`runs/${encodeURIComponent(id)}`);
export const videoUrl = (id: string) => `/api/runs/${encodeURIComponent(id)}/video`;
export const povUrl = (id: string) => `/api/runs/${encodeURIComponent(id)}/pov`;
