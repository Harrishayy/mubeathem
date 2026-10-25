import { api } from "../http";

export const mubitStatus = () => api<{ configured: boolean; model: string; base: string }>("mubit");
export const debrief = (system: string, messages: { role: string; content: string }[], signal?: AbortSignal) =>
  api<{ text: string; id: string | null; ms: number; usage: Record<string, number> | null; model: string }>("mubit/debrief", { json: { system, messages }, signal });
