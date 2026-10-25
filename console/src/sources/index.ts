// THE SOURCE REGISTRY. One line per data source; the top bar lets you switch between them.
//
//   Plug a source out:  delete its line.
//   Plug one in:        create src/sources/<id>/index.ts exporting a SourceDef, add it here.
//
// See src/sources/CLAUDE.md.

import type { SourceDef } from "./types";
import { runs } from "./runs";
import { demo } from "./demo";

export const SOURCES: SourceDef[] = [runs, demo];
export const sourceById = (id: string | null | undefined) => SOURCES.find((s) => s.id === id) || null;
