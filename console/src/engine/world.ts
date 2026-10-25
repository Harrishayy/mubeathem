// The simulated world: tasks, their settings and policies, scene variants, robots,
// and the wording Steward uses for results. Edit here to add a task or a robot.

import { fmtP } from "./format";
import type { Settings, Task, TaskKey, Variant } from "./types";

export const HIST = 215;   // seconds of fleet history generated before the console opens
export const GAP = 1.4;    // idle seconds between a robot's episodes

const POLICY_BASE = [
  "If any person is within 1.0 m of the robot, arm_speed must be 0.0 and the robot must not act.",
  "If any person is within 2.0 m of the robot, arm_speed must be 0.2 or lower.",
];

export const TASKS: Record<TaskKey, Task> = {
  pour: {
    name: "Pour", phases: ["approach", "pour", "return"],
    params: { arm_speed: [0, 1], pour_height_cm: [2, 30], tilt_speed: [0, 1], tilt_angle_deg: [60, 150] },
    prior: { arm_speed: 0.6, pour_height_cm: 14, tilt_speed: 0.75, tilt_angle_deg: 125 },
    limit: { k: "tilt_angle_deg", max: 150, over: 18 },
    metric: { name: "spilled", unit: "%", limit: 5 },
    policy: [...POLICY_BASE, "Never pour while the bowl position is unknown.", "tilt_angle_deg must not exceed 150."],
    escalate: { label: "insufficient_information", reason: "The bowl position is unknown: the overhead camera dropped 14 frames." },
    variants: [
      { subject: "water from a beaker into a wide bowl", applies: ["water", "wide"], phrase: "water into a wide bowl", contents: "water", bowl: "wide", ideal: { tilt_speed: [0.72, 0.28], pour_height_cm: [12, 9] } },
      { subject: "loose beads from a beaker into a narrow bowl", applies: ["loose", "beads", "narrow"], phrase: "loose beads into a narrow bowl", contents: "beads", bowl: "narrow", ideal: { tilt_speed: [0.36, 0.11], pour_height_cm: [6, 4] } },
      { subject: "thick syrup from a beaker into a wide bowl", applies: ["thick", "syrup", "wide"], phrase: "thick syrup into a wide bowl", contents: "syrup", bowl: "wide", ideal: { tilt_speed: [0.9, 0.13], pour_height_cm: [8, 6] } },
    ],
  },
  pick: {
    name: "Pick and place", phases: ["approach", "carry", "place"],
    params: { arm_speed: [0, 1], grip_force_n: [5, 50], lift_height_cm: [2, 30] },
    prior: { arm_speed: 0.65, grip_force_n: 18, lift_height_cm: 12 },
    limit: { k: "grip_force_n", max: 50, over: 10 },
    metric: { name: "slip", unit: "mm", limit: 8 },
    policy: [...POLICY_BASE, "Never place while the plate is out of view.", "grip_force_n must not exceed 50."],
    escalate: { label: "insufficient_information", reason: "The plate is missing from the last depth frame, so the place pose cannot be checked." },
    variants: [
      { subject: "a dry apple onto a plate", applies: ["dry", "apple"], phrase: "a dry apple", obj: "apple", ideal: { grip_force_n: [20, 9] } },
      { subject: "a wet apple onto a plate", applies: ["wet", "apple"], phrase: "a wet apple", obj: "apple", ideal: { grip_force_n: [32, 6], arm_speed: [0.42, 0.2] } },
      { subject: "a heavy glass jar onto a plate", applies: ["heavy", "glass", "jar"], phrase: "a heavy glass jar", obj: "jar", ideal: { grip_force_n: [42, 6], lift_height_cm: [6, 5] } },
    ],
  },
  stack: {
    name: "Stack", phases: ["approach", "lift", "place"],
    params: { arm_speed: [0, 1], place_speed: [0, 1], align_tolerance_mm: [1, 20] },
    prior: { arm_speed: 0.6, place_speed: 0.6, align_tolerance_mm: 8 },
    limit: { k: "arm_speed", max: 0.85, over: 0 },
    metric: { name: "tilt", unit: "°", limit: 12 },
    policy: [...POLICY_BASE, "Never release while the base position is uncertain.", "arm_speed must not exceed 0.85 while carrying glassware."],
    escalate: { label: "inconsistent_context", reason: "The wrist and overhead cameras disagree on where the base is by 4 cm." },
    variants: [
      { subject: "a ceramic cup onto a matching cup", applies: ["ceramic", "cup"], phrase: "a ceramic cup on a cup", obj: "cup", top: { w: 0.085, h: 0.1 }, base: { w: 0.085, h: 0.1, kind: "cup" }, ideal: { place_speed: [0.55, 0.25] } },
      { subject: "a tall glass onto a small saucer", applies: ["tall", "glass", "saucer"], phrase: "a tall glass on a saucer", obj: "glass", top: { w: 0.06, h: 0.17 }, base: { w: 0.16, h: 0.025, kind: "saucer" }, ideal: { place_speed: [0.25, 0.1], align_tolerance_mm: [3, 2.5] } },
    ],
  },
};
export const taskOf = (k: string): Task => TASKS[k as TaskKey] || TASKS.pour;

export const PHASE_DUR: Record<TaskKey, number[]> = { pour: [2.4, 3.0, 2.0], pick: [2.2, 3.0, 2.2], stack: [2.2, 2.8, 2.6] };
export const FAIL_PHASE: Record<TaskKey, number> = { pour: 1, pick: 1, stack: 2 };
export const FAIL_U: Record<TaskKey, number> = { pour: 0.45, pick: 0.6, stack: 0.66 };

export const ROBOTS: { id: string; name: string; task: TaskKey; model: string; env: string }[] = [
  { id: "gr1-01", name: "GR1-01", task: "pour", model: "GR-1 humanoid", env: "env 01" },
  { id: "gr1-02", name: "GR1-02", task: "pour", model: "GR-1 humanoid", env: "env 02" },
  { id: "gr1-03", name: "GR1-03", task: "pour", model: "GR-1 humanoid", env: "env 03" },
  { id: "gr1-04", name: "GR1-04", task: "pour", model: "GR-1 humanoid", env: "env 04" },
  { id: "panda-05", name: "PANDA-05", task: "pick", model: "Franka Panda", env: "env 05" },
  { id: "panda-06", name: "PANDA-06", task: "pick", model: "Franka Panda", env: "env 06" },
  { id: "panda-07", name: "PANDA-07", task: "pick", model: "Franka Panda", env: "env 07" },
  { id: "panda-08", name: "PANDA-08", task: "stack", model: "Franka Panda", env: "env 08" },
  { id: "panda-09", name: "PANDA-09", task: "stack", model: "Franka Panda", env: "env 09" },
];

// Mubit: base latency per task, and how long training takes once enough examples are kept.
export const MUBIT_CFG: Record<string, { base: number; sd: number; trainFor: number; label: string }> = {
  plan: { base: 1150, sd: 220, trainFor: 150, label: "Plan an attempt" },
  verify: { base: 620, sd: 110, trainFor: 60, label: "Verify before acting" },
  lesson: { base: 950, sd: 180, trainFor: 120, label: "Write a lesson" },
};
export const KEEP_TO_TRAIN = 25;

export function failReason(taskKey: TaskKey, v: Variant, worst: { k: string; dir: "hi" | "lo" }, plan: Settings, m: number) {
  const val = fmtP(worst.k, plan[worst.k]);
  const T: Record<string, Record<string, Record<string, string>>> = {
    pour: {
      tilt_speed: { hi: `Tipped too fast at tilt_speed ${val}; ${m}% of the ${v.contents} missed the bowl.`, lo: `Tipped too slowly at tilt_speed ${val}; ${m}% of the ${v.contents} ran down the outside of the beaker.` },
      pour_height_cm: { hi: `Poured from ${val} above the rim; ${m}% of the ${v.contents} splashed out.`, lo: `Poured from ${val} and the lip caught the rim; ${m}% spilled.` },
    },
    pick: {
      grip_force_n: { hi: `Squeezed at ${val} and the ${v.obj} popped out of the fingers.`, lo: `Gripped at ${val}; the ${v.obj} slipped ${m} mm, then fell.` },
      arm_speed: { hi: `Swung at arm_speed ${val} and the ${v.obj} slipped ${m} mm out of the grip.`, lo: `Moved at arm_speed ${val}; the ${v.obj} slipped while the arm crept.` },
      lift_height_cm: { hi: `Lifted the ${v.obj} to ${val}; it swung loose and fell.`, lo: `Lifted only ${val} and dragged the ${v.obj} off the table edge.` },
    },
    stack: {
      place_speed: { hi: `Set down at place_speed ${val}; the ${v.obj} tipped ${m}° and fell.`, lo: `Set down at place_speed ${val}; the ${v.obj} stuck, then tipped ${m}°.` },
      align_tolerance_mm: { hi: `Aligned only within ${val}; the ${v.obj} landed off-centre and tipped ${m}°.`, lo: `Aligned within ${val} and kept correcting; the ${v.obj} tipped ${m}°.` },
    },
  };
  return T[taskKey]?.[worst.k]?.[worst.dir] || `The ${worst.k} setting of ${val} did not work for ${v.phrase}.`;
}

export function successReason(taskKey: TaskKey, v: Variant, m: number) {
  if (taskKey === "pour") return `All the ${v.contents} landed in the bowl; ${m}% spilled, under the 5% limit.`;
  if (taskKey === "pick") return `The ${v.obj} is on the plate; slip ${m} mm.`;
  return `The ${v.obj} is standing; tilt ${m}°.`;
}

export function okReason(taskKey: TaskKey, phase: string, plan: Settings) {
  if (taskKey === "pour" && phase === "pour") return `Nobody within 2 m, the bowl is located and tilt ${plan.tilt_angle_deg}° is within 150°.`;
  if (taskKey === "pick" && phase === "carry") return `Nobody within 2 m and grip ${plan.grip_force_n} N is under the 50 N limit.`;
  if (taskKey === "stack" && phase === "lift") return `Nobody within 2 m and arm_speed ${fmtP("arm_speed", plan.arm_speed)} is under the 0.85 glassware limit.`;
  return "Nobody within 2 m; every rule in the policy is met.";
}
