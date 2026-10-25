// The panel registry: id → module. One line per panel. src/tabs.ts places them.

import type { PanelModule } from "@/console/types";
import * as activity from "./activity";
import * as attention from "./attention";
import * as callInspector from "./call-inspector";
import * as debrief from "./debrief";
import * as decisionTrace from "./decision-trace";
import * as dontList from "./dont-list";
import * as dsComponents from "./ds-components";
import * as dsLayout from "./ds-layout";
import * as dsPrinciples from "./ds-principles";
import * as dsTokens from "./ds-tokens";
import * as eventDetail from "./event-detail";
import * as eventLog from "./event-log";
import * as failures from "./failures";
import * as learningCurve from "./learning-curve";
import * as lessonImpact from "./lesson-impact";
import * as lessons from "./lessons";
import * as modelCalls from "./model-calls";
import * as mubitLatency from "./mubit-latency";
import * as mubitTasks from "./mubit-tasks";
import * as practice from "./practice";
import * as replayStage from "./replay-stage";
import * as robotGrid from "./robot-grid";
import * as robotList from "./robot-list";
import * as sapling from "./sapling";
import * as services from "./services";
import * as takes from "./takes";

export const PANELS: Record<string, PanelModule> = {
  "activity": activity,
  "attention": attention,
  "call-inspector": callInspector,
  "debrief": debrief,
  "decision-trace": decisionTrace,
  "dont-list": dontList,
  "ds-components": dsComponents,
  "ds-layout": dsLayout,
  "ds-principles": dsPrinciples,
  "ds-tokens": dsTokens,
  "event-detail": eventDetail,
  "event-log": eventLog,
  "failures": failures,
  "learning-curve": learningCurve,
  "lesson-impact": lessonImpact,
  "lessons": lessons,
  "model-calls": modelCalls,
  "mubit-latency": mubitLatency,
  "mubit-tasks": mubitTasks,
  "practice": practice,
  "replay-stage": replayStage,
  "robot-grid": robotGrid,
  "robot-list": robotList,
  "sapling": sapling,
  "services": services,
  "takes": takes,
};
