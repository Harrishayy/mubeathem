"use client";

import { useRef, useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { fmtClock, EPOCH } from "@/engine/format";
import s from "./takes.module.css";

export const meta: PanelMeta = { title: "Takes", minHeight: 150, about: "Steward's recorded takes in the runs dir (story, mode, video, verifier), and opening a take file by hand." };

export default function Takes() {
  const { st, actions } = useConsole();
  useTick(["robots", "source"]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const open = (f?: File | null) => { if (f) actions.openTake(f); };
  const takes = [...st.takes].reverse();
  const firstEp = (take: string) => Object.values(st.episodes).filter((e) => e.take === take).sort((a, b) => a.start - b.start)[0];

  return (
    <>
      <PanelSub><b>{st.takes.length}</b> takes · {st.takes.filter((t) => t.video).length} with video{st.takes.some((t) => t.live) ? " · one writing now" : ""}</PanelSub>
      <div className={s.wrap}>
        {takes.length ? (
          <table className="tbl">
            <thead><tr><th>Take</th><th>Story</th><th>Mode</th><th>Checks</th><th /></tr></thead>
            <tbody>
              {takes.map((t) => {
                const ep = firstEp(t.id);
                return (
                  <tr key={t.id}>
                    <td><div className="mono">{t.id}</div><div className="subtle">{fmtClock(t.started - EPOCH)} · {t.events} events{t.live ? " · writing now" : ""}</div></td>
                    <td>{t.story}</td>
                    <td className="n">{t.mode}{t.model ? ` · ${t.model}` : ""}{t.video ? ` · video ${t.video.fps} fps` : " · no video"}</td>
                    <td className="n">{t.verifier || "—"}</td>
                    <td>{ep ? <button className="btn sm" type="button" onClick={() => actions.replay(ep.robot, ep.id)}>Replay</button> : <span className="subtle">no attempts</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="empty">{st.source.note || "No takes yet."}</p>}
        {actions.can.openTake && (
          <div
            className={`${s.drop}${over ? ` ${s.over}` : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); open(e.dataTransfer.files?.[0]); }}
          >
            <p>Open a take file that isn&apos;t in the runs dir:</p>
            <button className="btn sm primary" type="button" onClick={() => input.current?.click()}>Choose a .jsonl file</button>
            <input ref={input} type="file" accept=".jsonl,.json,.txt,application/json" hidden onChange={(e) => { open(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        )}
        <details className={s.fmt}><summary>Take format</summary><p>One JSON object per line, as Steward&apos;s EventLog writes them (steward/EVENTS.md). Attempts split on <code>attempt</code> events and group by <code>robot</code>. Isaac takes add <code>.mp4</code>, <code>.pov.mp4</code> and <code>.frames.json</code> beside the log.</p></details>
      </div>
    </>
  );
}
