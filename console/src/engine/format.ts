// Numbers, units and clocks, formatted the same way everywhere.

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const median = (a: number[]): number | null => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const wordsOf = (t: string) => new Set(String(t).toLowerCase().match(/[a-z]+/g) || []);

// Console time ("abs") is Unix seconds less EPOCH, which keeps the numbers small in charts.
// Steward logs Unix seconds (`t`), so abs = t - EPOCH and fmtClock adds it back.
export const EPOCH = 1.7e9;
export function fmtClock(abs: number, tenths = false) {
  const d = new Date((EPOCH + abs) * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${tenths ? "." + Math.floor(d.getUTCMilliseconds() / 100) : ""}`;
}
export const fmtT = (t: number) => `${t.toFixed(1)} s`;

// Plan settings carry their unit in the name, as the planner returns them.
export const SHORT: Record<string, string> = { arm_speed: "arm", pour_height_cm: "height", tilt_speed: "tilt speed", tilt_angle_deg: "tilt" };
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
