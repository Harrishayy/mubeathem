// Side-view drawing of one episode at time t: robot, table, task objects, the 1 m and
// 2 m zones, and anyone walking in. Every frame is a pure function of (episode, t),
// so replay can scrub freely.

import { clamp, lerp, mix, ease, type Pt } from "./format";
import { hsh } from "./random";
import { C, alpha } from "./theme";
import { stateAt, poseAt } from "./timeline";
import type { Episode, Robot } from "./types";

type Ctx = CanvasRenderingContext2D;
type F = (n: number) => number;
interface Scene { ee: Pt; grip: number; beaker?: boolean; back: () => void; front: () => void }

const SH = { x: 0.5, y: 1.04 }, L1 = 0.62, L2 = 0.58, HOME = { x: 0.95, y: 1.22 };
const BOWL_X = 1.5, TABLE_Y = 0.75;
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

function sizeCanvas(cv: HTMLCanvasElement) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
function ik(T: Pt) {
  const dx = T.x - SH.x, dy = T.y - SH.y;
  const d = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const a = Math.atan2(dy, dx);
  const th = a + Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  return { E: { x: SH.x + L1 * Math.cos(th), y: SH.y + L1 * Math.sin(th) }, W: { x: SH.x + d * Math.cos(a), y: SH.y + d * Math.sin(a) } };
}
const rot = (o: Pt, x: number, y: number, ang: number): Pt => { const a = (-ang * Math.PI) / 180; return { x: o.x + x * Math.cos(a) - y * Math.sin(a), y: o.y + x * Math.sin(a) + y * Math.cos(a) }; };
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function poly(ctx: Ctx, X: F, Y: F, pts: Pt[]) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.closePath(); }

// ---- pour ----
const bowlW = (ep: Episode) => (ep.variant.bowl === "narrow" ? 0.2 : 0.34);
const tiltAt = (p: Record<string, number>, u: number) => p.tilt_angle_deg * ease(clamp(u / (0.2 + (1 - p.tilt_speed) * 0.55), 0, 1));
function pourPose(ep: Episode, t: number) {
  const { phase, u } = poseAt(ep, t), p = ep.plan;
  const P = { x: BOWL_X - 0.15, y: 0.86 + 0.07 + (p.pour_height_cm / 100) * 0.9 + 0.06 };
  if (phase < 0) return { ee: HOME, ang: 0 };
  if (phase === 0) return { ee: mix(HOME, P, ease(u)), ang: 0 };
  if (phase === 1) return { ee: P, ang: tiltAt(p, u) };
  return { ee: mix(P, HOME, ease(clamp((u - 0.15) / 0.85, 0, 1))), ang: tiltAt(p, 1) * (1 - ease(clamp(u / 0.3, 0, 1))) };
}
function pourWindow(ep: Episode) {
  if (ep._pw !== undefined) return ep._pw;
  const s1 = ep.segs.find((s) => s.kind === "motion" && s.phase === 1), s2 = ep.segs.find((s) => s.kind === "motion" && s.phase === 2);
  if (!s1) return (ep._pw = null);
  const thr = Math.min(80, ep.plan.tilt_angle_deg * 0.6);
  let ts = s1.t1;
  for (let k = 0; k <= 100; k++) { const u = k / 100; if (tiltAt(ep.plan, u) >= thr) { ts = s1.t0 + u * (s1.t1 - s1.t0); break; } }
  const te = s2 ? s2.t0 + 0.1 * (s2.t1 - s2.t0) : s1.t1;
  return (ep._pw = { ts, te: Math.max(te, ts + 0.3) });
}
function pourScene(ctx: Ctx, ep: Episode, t: number, X: F, Y: F, L: F): Scene {
  const { ee, ang } = pourPose(ep, t);
  const bw = bowlW(ep), win = pourWindow(ep), N = 44, rim = 0.86;
  const spillFrac = ep.outcome === "failed" ? clamp((ep.metric / 100) * 1.8, 0.12, 0.6) : 0;
  const emitted = win ? clamp((t - win.ts) / (win.te - win.ts), 0, 1) : 0;
  const back = () => {
    ctx.beginPath();
    ctx.moveTo(X(BOWL_X - bw / 2), Y(rim));
    ctx.quadraticCurveTo(X(BOWL_X - bw / 2), Y(TABLE_Y), X(BOWL_X), Y(TABLE_Y));
    ctx.quadraticCurveTo(X(BOWL_X + bw / 2), Y(TABLE_Y), X(BOWL_X + bw / 2), Y(rim));
    ctx.fillStyle = C.s2; ctx.fill(); ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.stroke();
  };
  const front = () => {
    const bwk = 0.09, top = 0.1, bot = -0.08, fill = (1 - emitted) * 0.85;
    if (fill > 0.02) {
      const fy = bot + (top - bot) * fill;
      poly(ctx, X, Y, [[0.006, bot + 0.006], [bwk - 0.006, bot + 0.006], [bwk - 0.006, fy], [0.006, fy]].map(([x, y]) => rot(ee, x, y, ang)));
      ctx.fillStyle = alpha(C.fg, 0.28); ctx.fill();
    }
    poly(ctx, X, Y, [[0, bot], [bwk, bot], [bwk, top], [0, top]].map(([x, y]) => rot(ee, x, y, ang)));
    ctx.strokeStyle = C.fg; ctx.lineWidth = 1.5; ctx.stroke();
    if (!win || t < win.ts) return;
    const g = 2.4, rr = Math.max(1.1, L(ep.variant.contents === "water" ? 0.009 : 0.012));
    for (let i = 0; i < N; i++) {
      const te = win.ts + ((i + 0.5) / N) * (win.te - win.ts);
      if (t < te) break;
      const lp = pourPose(ep, te), lip = rot(lp.ee, 0.09, 0.1, lp.ang);
      const spill = hsh(i, 1) < spillFrac, side = hsh(i, 3) < 0.7 ? 1 : -1;
      const xl = spill ? BOWL_X + side * (bw / 2 + 0.05 + hsh(i, 2) * 0.26) : BOWL_X + (hsh(i, 2) - 0.5) * bw * 0.55;
      const yl = spill ? TABLE_Y + 0.012 : TABLE_Y + 0.02 + Math.floor(i / 8) * 0.012;
      const T = Math.sqrt(Math.max(0.01, (2 * (lip.y - yl)) / g)), a = t - te;
      const x = a >= T ? xl : lerp(lip.x, xl, a / T), y = a >= T ? yl : lip.y - 0.5 * g * a * a;
      ctx.beginPath(); ctx.arc(X(x), Y(y), rr, 0, Math.PI * 2);
      ctx.fillStyle = spill && a >= T * 0.7 ? C.fail : C.fg; ctx.fill();
    }
  };
  return { ee, grip: 0, beaker: true, back, front };
}

// ---- pick and place ----
function pickPose(ep: Episode, t: number) {
  const { phase, u } = poseAt(ep, t), p = ep.plan;
  const A1 = { x: 1.02, y: 1.0 }, A0 = { x: 1.02, y: 0.885 };
  const liftY = 0.885 + p.lift_height_cm / 100 + 0.06;
  const C1 = { x: 1.02, y: liftY }, C2 = { x: 1.64, y: liftY }, D0 = { x: 1.64, y: 0.9 }, D1 = { x: 1.64, y: 1.06 };
  if (phase < 0) return { ee: HOME, grip: 0 };
  if (phase === 0) return { ee: u < 0.6 ? mix(HOME, A1, ease(u / 0.6)) : mix(A1, A0, ease((u - 0.6) / 0.4)), grip: 0 };
  if (phase === 1) return { ee: u < 0.15 ? A0 : u < 0.4 ? mix(A0, C1, ease((u - 0.15) / 0.25)) : mix(C1, C2, ease((u - 0.4) / 0.6)), grip: ease(clamp(u / 0.15, 0, 1)) };
  return { ee: u < 0.5 ? mix(C2, D0, ease(u / 0.5)) : u < 0.62 ? D0 : mix(D0, D1, ease((u - 0.62) / 0.38)), grip: u < 0.5 ? 1 : 1 - ease(clamp((u - 0.5) / 0.12, 0, 1)) };
}
function pickScene(ctx: Ctx, ep: Episode, t: number, X: F, Y: F, L: F): Scene {
  const { ee, grip } = pickPose(ep, t);
  const v = ep.variant, R = 0.045, { phase, u } = poseAt(ep, t), restY = TABLE_Y + R;
  let obj: Pt;
  if (ep.failAt != null && t >= ep.failAt) {
    const s = pickPose(ep, ep.failAt).ee, y0 = s.y - 0.06, a = t - ep.failAt, g = 2.4;
    const T = Math.sqrt((2 * (y0 - restY)) / g);
    obj = a < T ? { x: s.x + 0.32 * a, y: y0 - 0.5 * g * a * a } : { x: s.x + 0.32 * T + 0.14 * (1 - Math.exp(-3 * (a - T))), y: restY };
  } else if (phase < 1 || (phase === 1 && u < 0.15)) obj = { x: 1.02, y: restY };
  else if (phase === 1 || (phase === 2 && u < 0.55)) obj = { x: ee.x, y: ee.y - 0.06 };
  else obj = { x: 1.64, y: TABLE_Y + 0.012 + R };
  const bad = ep.outcome === "failed" && ep.failAt != null && t >= ep.failAt;
  const back = () => {
    ctx.beginPath(); ctx.ellipse(X(1.64), Y(TABLE_Y + 0.008), L(0.13), L(0.012), 0, 0, Math.PI * 2);
    ctx.fillStyle = C.s2; ctx.fill(); ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.stroke();
  };
  const front = () => {
    ctx.strokeStyle = bad ? C.fail : C.fg; ctx.fillStyle = bad ? alpha(C.fail, 0.25) : alpha(C.fg, 0.16); ctx.lineWidth = 1.5;
    if (v.obj === "jar") {
      roundRect(ctx, X(obj.x - 0.04), Y(obj.y + 0.05), L(0.08), L(0.1), L(0.012)); ctx.fill(); ctx.stroke();
      ctx.fillRect(X(obj.x - 0.03), Y(obj.y + 0.065), L(0.06), L(0.015));
    } else {
      ctx.beginPath(); ctx.arc(X(obj.x), Y(obj.y), L(R), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(obj.x), Y(obj.y + R)); ctx.lineTo(X(obj.x + 0.012), Y(obj.y + R + 0.025)); ctx.stroke();
      if (v.subject.includes("wet")) { ctx.fillStyle = bad ? C.fail : C.muted; for (let i = 0; i < 3; i++) ctx.fillRect(X(obj.x - 0.02 + i * 0.02), Y(obj.y - R - 0.012 - (i % 2) * 0.01), 1.5, 1.5); }
    }
  };
  return { ee, grip, back, front };
}

// ---- stack ----
function stackPose(ep: Episode, t: number) {
  const { phase, u } = poseAt(ep, t), v = ep.variant, p = ep.plan;
  const hA = v.top!.h, hB = v.base!.h, gripOff = hA * 0.6;
  const A_top = { x: 1.0, y: TABLE_Y + hA + 0.12 }, A_g = { x: 1.0, y: TABLE_Y + gripOff + 0.07 };
  const carryY = TABLE_Y + hB + hA + 0.22, off = ((p.align_tolerance_mm - 3) / 1000) * 4;
  const C1 = { x: 1.0, y: carryY }, C2o = { x: 1.62 + off, y: carryY };
  const D0o = { x: 1.62 + off, y: TABLE_Y + hB + gripOff + 0.07 };
  if (phase < 0) return { ee: HOME, grip: 0, off };
  if (phase === 0) return { ee: u < 0.6 ? mix(HOME, A_top, ease(u / 0.6)) : mix(A_top, A_g, ease((u - 0.6) / 0.4)), grip: 0, off };
  if (phase === 1) return { ee: u < 0.15 ? A_g : u < 0.45 ? mix(A_g, C1, ease((u - 0.15) / 0.3)) : mix(C1, C2o, ease((u - 0.45) / 0.55)), grip: ease(clamp(u / 0.15, 0, 1)), off };
  return { ee: u < 0.55 ? mix(C2o, D0o, ease(u / 0.55)) : u < 0.66 ? D0o : mix(D0o, C2o, ease((u - 0.66) / 0.34)), grip: u < 0.58 ? 1 : 1 - ease(clamp((u - 0.58) / 0.08, 0, 1)), off };
}
function cupPath(ctx: Ctx, X: F, Y: F, cx: number, bottom: number, w: number, h: number, ang: number) {
  const pivot = { x: cx + w / 2, y: bottom };
  poly(ctx, X, Y, [[-w / 2, 0], [w / 2, 0], [w / 2 + w * 0.12, h], [-w / 2 - w * 0.12, h]].map(([x, y]) => (ang ? rot(pivot, x - w / 2, y, ang) : { x: cx + x, y: bottom + y })));
}
function stackScene(ctx: Ctx, ep: Episode, t: number, X: F, Y: F, L: F): Scene {
  const { ee, grip, off } = stackPose(ep, t);
  const v = ep.variant, { phase, u } = poseAt(ep, t);
  const hA = v.top!.h, wA = v.top!.w, hB = v.base!.h, wB = v.base!.w, seated = TABLE_Y + hB;
  let bottom: number, cx: number, ang = 0;
  if (phase < 1 || (phase === 1 && u < 0.15)) { cx = 1.0; bottom = TABLE_Y; }
  else if (phase === 1 || (phase === 2 && u < 0.58)) { cx = ee.x; bottom = ee.y - 0.07 - hA * 0.6; }
  else { cx = 1.62 + off; bottom = seated; }
  if (ep.failAt != null && t >= ep.failAt) {
    const a = t - ep.failAt;
    ang = Math.min(84, a * a * 160 + a * 30);
    if (ang > 40) { const k = clamp((ang - 40) / 44, 0, 1); bottom = lerp(seated, TABLE_Y, k); cx = 1.62 + off + k * 0.12; }
  }
  const bad = ep.outcome === "failed" && ep.failAt != null && t >= ep.failAt;
  const back = () => {
    ctx.strokeStyle = C.muted; ctx.fillStyle = C.s2; ctx.lineWidth = 1.5;
    if (v.base!.kind === "saucer") { ctx.beginPath(); ctx.ellipse(X(1.62), Y(TABLE_Y + hB / 2), L(wB / 2), L(hB / 2), 0, 0, Math.PI * 2); }
    else cupPath(ctx, X, Y, 1.62, TABLE_Y, wB, hB, 0);
    ctx.fill(); ctx.stroke();
  };
  const front = () => {
    ctx.strokeStyle = bad ? C.fail : C.fg;
    ctx.fillStyle = bad ? alpha(C.fail, 0.2) : v.obj === "glass" ? "rgba(0,0,0,0)" : alpha(C.fg, 0.14);
    ctx.lineWidth = 1.5;
    cupPath(ctx, X, Y, cx, bottom, wA, hA, ang); ctx.fill(); ctx.stroke();
  };
  return { ee, grip, back, front };
}

const SCENES = { pour: pourScene, pick: pickScene, stack: stackScene };

// ---- shared pieces ----
function personAt(ep: Episode, t: number) {
  const p = ep.person; if (!p) return null;
  const IN = 1.6, OUT = 1.6, stand = 2.1, off = 3.5;
  if (t < p.enter - IN || t > p.leave + OUT) return null;
  let x: number, walking = true;
  if (t < p.enter) x = lerp(off, stand, ease((t - (p.enter - IN)) / IN));
  else if (t <= p.leave) { x = stand; walking = false; }
  else x = lerp(stand, off, ease((t - p.leave) / OUT));
  return { x, walking, inside: t >= p.enter && t <= p.leave, t };
}
function drawPerson(ctx: Ctx, X: F, Y: F, L: F, pr: NonNullable<ReturnType<typeof personAt>>) {
  const col = pr.inside ? C.hold : C.muted;
  ctx.strokeStyle = col; ctx.fillStyle = alpha(col, 0.12); ctx.lineWidth = 1.5; ctx.lineCap = "round";
  const sw = pr.walking ? Math.sin(pr.t * 9) * 0.07 : 0;
  ctx.beginPath(); ctx.moveTo(X(pr.x), Y(0.86)); ctx.lineTo(X(pr.x + sw), Y(0)); ctx.moveTo(X(pr.x), Y(0.86)); ctx.lineTo(X(pr.x - sw), Y(0)); ctx.stroke();
  roundRect(ctx, X(pr.x - 0.09), Y(1.52), L(0.18), L(0.68), L(0.07)); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(pr.x), Y(1.63), L(0.075), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (pr.inside) { ctx.fillStyle = C.hold; ctx.textAlign = "center"; ctx.fillText(`${(pr.x - 0.5).toFixed(1)} m`, X(pr.x), Y(1.78)); }
}
function drawRobot(ctx: Ctx, X: F, Y: F, L: F, robot: Robot | undefined, sc: Scene, kind: string, t: number) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.fillStyle = C.s2; ctx.strokeStyle = C.line2; ctx.lineWidth = 1;
  if (robot?.model?.startsWith("GR-1")) {
    roundRect(ctx, X(0.32), Y(1.3), L(0.36), L(0.62), L(0.05)); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(0.5), Y(1.42), L(0.08), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.fillRect(X(0.46), Y(1.43), L(0.08), L(0.015));
    ctx.strokeStyle = C.line2; ctx.lineWidth = L(0.06);
    ctx.beginPath(); ctx.moveTo(X(0.43), Y(0.68)); ctx.lineTo(X(0.42), Y(0.02)); ctx.moveTo(X(0.57), Y(0.68)); ctx.lineTo(X(0.58), Y(0.02)); ctx.stroke();
  } else {
    ctx.fillRect(X(0.38), Y(0.98), L(0.24), L(0.98)); ctx.strokeRect(X(0.38), Y(0.98), L(0.24), L(0.98));
  }
  const { E, W } = ik(sc.ee);
  ctx.strokeStyle = C.muted; ctx.lineWidth = L(0.055);
  ctx.beginPath(); ctx.moveTo(X(SH.x), Y(SH.y)); ctx.lineTo(X(E.x), Y(E.y)); ctx.stroke();
  ctx.strokeStyle = C.fg; ctx.lineWidth = L(0.042);
  ctx.beginPath(); ctx.moveTo(X(E.x), Y(E.y)); ctx.lineTo(X(W.x), Y(W.y)); ctx.stroke();
  for (const [p, r] of [[SH, 0.045], [E, 0.034]] as [Pt, number][]) {
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), L(r), 0, Math.PI * 2);
    ctx.fillStyle = C.bg; ctx.fill(); ctx.strokeStyle = C.fg; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.strokeStyle = C.fg; ctx.lineWidth = Math.max(1.5, L(0.016));
  ctx.beginPath();
  if (sc.beaker) {
    ctx.moveTo(X(W.x - 0.02), Y(W.y + 0.03)); ctx.lineTo(X(W.x + 0.01), Y(W.y + 0.03));
    ctx.moveTo(X(W.x - 0.02), Y(W.y - 0.03)); ctx.lineTo(X(W.x + 0.01), Y(W.y - 0.03));
  } else {
    const o = 0.045 - sc.grip * 0.03;
    ctx.moveTo(X(W.x - 0.05), Y(W.y)); ctx.lineTo(X(W.x + 0.05), Y(W.y));
    ctx.moveTo(X(W.x - o), Y(W.y)); ctx.lineTo(X(W.x - o), Y(W.y - 0.07));
    ctx.moveTo(X(W.x + o), Y(W.y)); ctx.lineTo(X(W.x + o), Y(W.y - 0.07));
  }
  ctx.stroke();
  // dashed ring while Mubit decides, amber ring while holding
  if (kind === "decide" || kind === "hold") {
    ctx.save();
    ctx.strokeStyle = kind === "hold" ? C.hold : C.fg; ctx.lineWidth = 1.4;
    if (kind === "decide") { ctx.setLineDash([L(0.025), L(0.025)]); ctx.lineDashOffset = -t * 30; }
    ctx.beginPath(); ctx.arc(X(SH.x), Y(SH.y), L(0.13), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/** Draw `ep` at time `t` into `cv`. `minimal` drops the grid and labels for thumbnails. */
export function drawScene(cv: HTMLCanvasElement, ep: Episode | null, t: number, robot?: Robot, minimal = false) {
  const g = sizeCanvas(cv); if (!g || !ep) return;
  const { ctx, w, h } = g;
  const WW = 3.3, WH = 1.78, sc = Math.min(w / WW, h / WH);
  const ox = (w - WW * sc) / 2, oy = h - (h - WH * sc) / 2 - 0.05 * sc;
  const X: F = (x) => ox + x * sc, Y: F = (y) => oy - y * sc, L: F = (d) => d * sc;
  ctx.clearRect(0, 0, w, h);
  const st = stateAt(ep, t);
  if (!minimal) {
    ctx.fillStyle = alpha(C.line2, 0.9);
    for (let x = 0.25; x < WW; x += 0.25) for (let y = 0.25; y < WH; y += 0.25) ctx.fillRect(X(x) - 0.5, Y(y) - 0.5, 1, 1);
  }
  const pr = personAt(ep, t);
  if (pr && pr.x < 2.5) { ctx.fillStyle = alpha(C.hold, 0.08); ctx.fillRect(X(0.5), Y(WH), X(2.5) - X(0.5), Y(0) - Y(WH)); }
  ctx.strokeStyle = C.line2; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(0.05), Y(0)); ctx.lineTo(X(3.25), Y(0)); ctx.stroke();
  ctx.font = `500 ${Math.max(8, Math.min(11, L(0.05)))}px ${MONO}`; ctx.fillStyle = C.subtle; ctx.textAlign = "center";
  ctx.setLineDash([3, 3]);
  for (const [x, lab] of [[1.5, "1 m"], [2.5, "2 m"]] as [number, string][]) {
    ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(0.16)); ctx.stroke();
    if (!minimal) ctx.fillText(lab, X(x), Y(0.2));
  }
  ctx.setLineDash([]);
  ctx.fillStyle = C.s3; ctx.strokeStyle = C.line2;
  ctx.fillRect(X(0.86), Y(TABLE_Y), L(1.2), L(0.03)); ctx.strokeRect(X(0.86), Y(TABLE_Y), L(1.2), L(0.03));
  ctx.beginPath(); ctx.moveTo(X(0.92), Y(TABLE_Y - 0.03)); ctx.lineTo(X(0.92), Y(0)); ctx.moveTo(X(2.0), Y(TABLE_Y - 0.03)); ctx.lineTo(X(2.0), Y(0)); ctx.stroke();
  const scene = (SCENES[ep.task] || pourScene)(ctx, ep, t, X, Y, L);
  scene.back();
  drawRobot(ctx, X, Y, L, robot, scene, st.kind, t);
  scene.front();
  if (pr) drawPerson(ctx, X, Y, L, pr);
}
