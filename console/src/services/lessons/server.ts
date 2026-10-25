// Lessons: the lesson files Steward's LessonStore reads and writes. The file is the source
// of truth (steward/lessons.py re-reads it before every recall), so a lesson added or
// retired here reaches robots that are already running.
//
//   GET  /api/lessons          every lesson file in the runs dir
//   POST /api/lessons          { file?, text, applies_to, source? } -> the new lesson
//   POST /api/lessons/retire   { file, id, retired }               -> the changed lesson

import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runsDir } from "../server/env";
import { fail, json, readJson } from "../server/http";
import type { ServerService } from "../server/types";
import type { LessonFile, StoredLesson } from "../types";

/** The shared fleet file: practice runs read it, and Isaac takes can with --lessons. */
export const FLEET_FILE = "practice-lessons.json";
/** Written by `steward.practice --offline` from scripted stand-ins, so never shown or written here. */
const OFFLINE_FILE = "offline-lessons.json";

function lessonFiles(): string[] {
  const dir = runsDir(), out: string[] = [];
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json") && /lesson/.test(f) && f !== OFFLINE_FILE) out.push(f);
  const takes = path.join(dir, "takes");
  if (existsSync(takes)) for (const f of readdirSync(takes)) if (f.endsWith(".lessons.json")) out.push(path.join("takes", f));
  if (!out.includes(FLEET_FILE)) out.unshift(FLEET_FILE);
  return out;
}

function read(rel: string): StoredLesson[] {
  const p = path.join(runsDir(), rel);
  if (!existsSync(p)) return [];
  try { const v = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Atomic, like LessonStore._save: write a temp file, then rename over the original. */
function write(rel: string, lessons: StoredLesson[]) {
  const p = path.join(runsDir(), rel);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.console.tmp`;
  writeFileSync(tmp, JSON.stringify(lessons, null, 2));
  renameSync(tmp, p);
}

/** Only files this service lists can be written, so a request can't name an arbitrary path. */
function resolveFile(rel: unknown): string | null {
  const f = typeof rel === "string" && rel ? rel : FLEET_FILE;
  return lessonFiles().includes(f) ? f : null;
}

const nextId = (lessons: StoredLesson[]) => `lesson-${Math.max(0, ...lessons.map((l) => Number(/^lesson-(\d+)$/.exec(l.id)?.[1] || 0))) + 1}`;
const words = (v: unknown) => (Array.isArray(v) ? v : []).map((w) => String(w).toLowerCase().trim()).filter((w) => /^[a-z]+$/.test(w)).slice(0, 4);

export function listLessonFiles(): LessonFile[] {
  return lessonFiles().map((file) => {
    const p = path.join(runsDir(), file);
    return {
      file, shared: file === FLEET_FILE,
      scope: file === FLEET_FILE ? "fleet" : file.startsWith("takes/") ? path.basename(file, ".lessons.json") : path.basename(file, ".json"),
      lessons: read(file), mtime: existsSync(p) ? statSync(p).mtimeMs : 0,
    };
  });
}

export const service: ServerService = {
  id: "lessons",
  label: "Lesson files",
  about: "Reads and writes the lesson files robots recall from, so lessons added or retired here reach running robots.",
  routes: [
    { method: "GET", path: "", handle: () => json({ files: listLessonFiles(), fleetFile: FLEET_FILE }) },
    {
      method: "POST", path: "",
      async handle(req) {
        const b = await readJson<{ file?: string; text?: string; applies_to?: unknown; source?: string }>(req);
        const file = resolveFile(b?.file);
        if (!b || !file) return fail(400, "bad_file", "Name one of the lesson files GET /api/lessons lists.");
        const text = String(b.text || "").trim().slice(0, 400), applies = words(b.applies_to);
        if (!text || applies.length < 1) return fail(400, "bad_lesson", "A lesson needs text and at least one lowercase applies_to word.");
        const lessons = read(file);
        const lesson: StoredLesson = {
          id: nextId(lessons), text, applies_to: applies, source_robot: String(b.source || "operator").slice(0, 60),
          uses: 0, successes: 0, created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        };
        write(file, [...lessons, lesson]);
        return json({ file, lesson }, 201);
      },
    },
    {
      method: "POST", path: "retire",
      async handle(req) {
        const b = await readJson<{ file?: string; id?: string; retired?: boolean }>(req);
        const file = resolveFile(b?.file);
        if (!b || !file) return fail(400, "bad_file", "Name one of the lesson files GET /api/lessons lists.");
        const lessons = read(file), l = lessons.find((x) => x.id === b.id);
        if (!l) return fail(404, "not_found", `No ${b.id} in ${file}.`);
        l.retired = b.retired !== false;
        write(file, lessons);
        return json({ file, lesson: l });
      },
    },
  ],
  async health() {
    const files = listLessonFiles(), n = files.reduce((a, f) => a + f.lessons.length, 0);
    return { status: n ? "ok" : "idle", summary: `${n} lesson${n === 1 ? "" : "s"} in ${files.filter((f) => f.mtime).length} file${files.length === 1 ? "" : "s"}; the fleet file is runs/${FLEET_FILE}.`, detail: { files: files.map((f) => f.file) } };
  },
};
