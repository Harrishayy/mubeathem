"use client";

// Copy this folder to start a new panel:
//   1. cp -r src/panels/_template src/panels/<id>
//   2. register it in src/panels/index.ts: import * as x from "./<id>", then "<id>": x in PANELS
//   3. add { id: "<id>" } to a tab's column in src/tabs.ts
//
// A panel module exports `meta` and a default component. Inside, use:
//   useConsole()            { st, actions, store }: read st, change things through actions
//   useTick(events, ms)     re-render when engine events fire (events list: src/engine/store.ts)
//   useFrame(fn)            run every frame, for canvas or imperative updates
//   usePanel()              { collapsed }: skip heavy work while collapsed
//   <PanelSub>              the header's one-line summary, visible even when collapsed
//   <PanelActions>          small controls on the right of the header

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";

export const meta: PanelMeta = { title: "Example", grow: 1, minHeight: 120, about: "What this panel shows, in one line." };

export default function Example() {
  const { st } = useConsole();
  useTick(["episode:done"]);
  return (
    <>
      <PanelSub><b>{st.done.length}</b> episodes</PanelSub>
      <p className="empty">{st.done.length} episodes have finished so far.</p>
    </>
  );
}
