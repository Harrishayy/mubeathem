import { api } from "../http";
import type { PracticeArgs, PracticeStatus } from "../types";

export const practiceStatus = () => api<PracticeStatus>("practice");
export const startPractice = (args: PracticeArgs) => api<PracticeStatus>("practice", { json: args });
export const stopPractice = () => api<PracticeStatus>("practice", { method: "DELETE" });
