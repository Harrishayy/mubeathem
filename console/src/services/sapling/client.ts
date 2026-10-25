import { api } from "../http";
import type { SaplingCheck } from "../types";

export interface SaplingAnswer { status: string; raw_label: string; prediction_set: string[]; probabilities: Record<string, number>; ms: number }
export const saplingStatus = () => api<{ configured: boolean; where: string | null; up: boolean; weights?: string; error?: string }>("sapling");
export const checkClaim = (c: SaplingCheck) => api<SaplingAnswer>("sapling/verify", { json: c });
