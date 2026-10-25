import { api } from "../http";
import type { LessonFile, StoredLesson } from "../types";

export const listLessons = () => api<{ files: LessonFile[]; fleetFile: string }>("lessons");
export const addLesson = (l: { file?: string; text: string; applies_to: string[]; source?: string }) => api<{ file: string; lesson: StoredLesson }>("lessons", { json: l });
export const retireLesson = (file: string, id: string, retired: boolean) => api<{ file: string; lesson: StoredLesson }>("lessons/retire", { json: { file, id, retired } });
