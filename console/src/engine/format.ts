// Numbers, units and clocks, formatted the same way everywhere.

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export type Pt = { x: number; y: number };
export const mix = (A: Pt, B: Pt, u: number): Pt => ({ x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u) });
export const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const median = (a: number[]): number | null => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const wordsOf = (t: string) => new Set(String(t).toLowerCase().match(/[a-z]+/g) || []);

// The simulated session clock: simNow = 0 is 09:14:00 UTC.
export const EPOCH = Date.UTC(2026, 9, 24, 9, 14, 0) / 1000;
export const TAKE = "fleet-20261024-0900";
export function fmtClock(abs: number, tenths = false) {
  const d = new Date((EPOCH + abs) * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${tenths ? "." + Math.floor(d.getUTCMilliseconds() / 100) : ""}`;
}
export const fmtT = (t: number) => `${t.toFixed(1)} s`;

// Plan settings carry their unit in the name, as the planner returns them.
export const SHORT: Record<string, string> = { arm_speed: "arm", pour_height_cm: "height", tilt_speed: "tilt speed", tilt_angle_deg: "tilt", grip_force_n: "grip", lift_height_cm: "lift", place_speed: "place speed", align_tolerance_mm: "align" };
export function roundP(k: string, v: number) {
  if (k.endsWith("_deg") || k.endsWith("_n")) return Math.round(v);
  if (k.endsWith("_cm") || k.endsWith("_mm")) return Math.round(v * 10) / 10;
  return r2(v);
}
export function fmtP(k: string, v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  if (k.endsWith("_cm")) return `${v} cm`;
  if (k.endsWith("_n")) return `${v} N`;
  if (k.endsWith("_mm")) return `${v} mm`;
  if (k.endsWith("_deg")) return `${v}°`;
  return Number(v).toFixed(2);
}
