"""The fleet's shared lessons: one JSON file every robot reads and writes.

The file is the source of truth: every recall and write re-reads it first, so a lesson
an operator adds or retires (in the console, or by hand) reaches robots already running.
A lesson with "retired": true is kept for the record but never recalled."""

import json
import re
import threading
import time
from pathlib import Path


def _words(text):
    return set(re.findall(r"[a-z]+", text.lower()))


class LessonStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.lessons = []
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self.lessons = json.loads(self.path.read_text())
            except ValueError:
                pass  # caught mid-write by another process; keep the last good copy

    def recall(self, subject):
        """Lessons sharing at least two applies_to words with the subject (one, if it lists one)."""
        words = _words(subject)
        with self.lock:
            self._load()
            found = []
            for lesson in self.lessons:
                if lesson.get("retired"):
                    continue
                keys = [w for w in lesson["applies_to"] if _words(w)]
                hits = sum(_words(w) <= words for w in keys)
                if keys and hits >= min(2, len(keys)):
                    found.append(dict(lesson))
            return found

    def add(self, text, applies_to, source):
        with self.lock:
            self._load()
            lesson = {
                "id": _next_id(self.lessons),
                "text": text,
                "applies_to": [w.lower().strip() for w in applies_to],
                "source_robot": source,
                "uses": 0,
                "successes": 0,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self.lessons.append(lesson)
            self._save()
            return dict(lesson)

    def record_use(self, lessons, success):
        ids = {lesson["id"] for lesson in lessons}
        if not ids:
            return
        with self.lock:
            self._load()
            for lesson in self.lessons:
                if lesson["id"] in ids:
                    lesson["uses"] += 1
                    lesson["successes"] += int(success)
            self._save()

    def retire(self, lesson_id, retired=True):
        with self.lock:
            self._load()
            for lesson in self.lessons:
                if lesson["id"] == lesson_id:
                    lesson["retired"] = retired
                    self._save()
                    return dict(lesson)
            raise KeyError(lesson_id)

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.lessons, indent=2))
        tmp.replace(self.path)


def _next_id(lessons):
    numbers = [int(m.group(1)) for l in lessons if (m := re.fullmatch(r"lesson-(\d+)", l["id"]))]
    return f"lesson-{max(numbers, default=0) + 1}"
