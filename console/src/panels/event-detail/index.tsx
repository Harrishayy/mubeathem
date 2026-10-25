"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph, EventText, Pill } from "@/ui/status";
import { fmtClock } from "@/engine/format";
import { toLine } from "@/engine/log";
import { nameOf } from "@/engine/state";
import s from "./event-detail.module.css";

export const meta: PanelMeta = { title: "Event detail", minHeight: 160, about: "The selected log row: what it says, its episode, and its raw JSON line." };

export default function EventDetail() {
  const { st, actions } = useConsole();
  useTick(["logsel"]);
  const l = st.logSel != null ? st.log.find((x) => x.seq === st.logSel) : null;
  if (!l) return <><PanelSub>nothing selected</PanelSub><p className="empty">Select a row in the event log to see its JSON line and replay that moment.</p></>;
  const ep = l.epId ? st.episodes[l.epId] : null;
  const r = ep ? st.byId[ep.robot] : null;
  const at = l.data.at;
  const line = JSON.stringify(toLine(l), null, 2);
  const copy = async () => { try { await navigator.clipboard.writeText(line); actions.toast("Copied the JSON line."); } catch { actions.toast("Copying isn't allowed here. Select the text instead."); } };
  return (
    <>
      <PanelSub><Glyph kind={l.kind} e={l.data} /> <b>{l.kind}</b> · {nameOf(st, l.robot)} · {fmtClock(l.abs, true)}</PanelSub>
      <div className={s.wrap}>
        <p className={s.text}><EventText e={l.data} /></p>
        {ep && r && (
          <div className={s.ep}>
            <span>{r.name} · {ep.take ? `${ep.take} attempt ${ep.attempt}` : `episode #${ep.n}`} · {at?.toFixed?.(2)} s in</span>
            {ep.outcome && <Pill status={ep.outcome} />}
            <span className="subtle">{ep.variant.subject}</span>
          </div>
        )}
        <div className={s.acts}>
          {ep && r && <button className="btn sm primary" type="button" onClick={() => actions.replay(ep.robot, !r.imported && r.ep.id === ep.id && r.live ? "live" : ep.id, { t: l.at, paused: true })}>Replay this moment</button>}
          {ep && l.kind === "call" && <button className="btn sm" type="button" onClick={() => { const i = ep.events.indexOf(l.data); if (i >= 0) { actions.selectCallAt(ep, i); actions.go("calls"); } }}>Inspect the call</button>}
          <button className="btn sm" type="button" onClick={copy}>Copy JSON</button>
        </div>
        <pre className={s.json}>{line}</pre>
      </div>
    </>
  );
}
