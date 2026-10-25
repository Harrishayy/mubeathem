// What a data source is. A source fills the engine state (src/engine/types.ts) and keeps
// it current; panels never know which source is running, only which capabilities it has.
// Real runs become state in one place, sources/runs/build.ts (see the repo's CLAUDE.md).

import type { Store } from "@/engine/store";
import type { Cap, Episode, Fix, Lesson, Settings, TaskKey } from "@/engine/types";

export interface NewLesson { task: TaskKey; text: string; applies_to: string[]; settings: Settings }

/** Operator actions whose effect depends on the source. Leave one out and the action is unavailable. */
export interface SourceOps {
  /** Resolves to the new lesson's id. */
  addLesson?(l: NewLesson, ep: Episode | null): Promise<string>;
  retireLesson?(l: Lesson): Promise<void>;
  /** Try a fix again. Resolves to a sentence saying what will happen. */
  rerun?(ep: Episode, fix: Fix): Promise<string>;
  /** Open a take file the operator dropped in. */
  openTake?(text: string, fileName: string): Promise<{ robotId: string; epId: string; summary: string }>;
}

export interface SourceRuntime {
  /** Every animation frame, with dt in seconds. */
  tick?(dt: number): void;
  stop(): void;
  ops: SourceOps;
}

export interface SourceDef {
  id: string;
  label: string;
  /** One word for the top bar's source switch. */
  short: string;
  /** One line for the source picker and the Services tab. */
  about: string;
  caps: Cap[];
  /** Fill store.state and start keeping it current. */
  start(store: Store): Promise<SourceRuntime>;
}
