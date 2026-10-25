"use client";

import { useRef, useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { fmtClock, EPOCH } from "@/engine/format";
import { prefs, setPref } from "@/sources/runs";
import s from "./takes.module.css";

export const meta: PanelMeta = { title: "Takes", minHeight: 150, about: "Steward's recorded takes in the runs dir (story, mode, video, verifier), and opening a take file by hand." };

const SAMPLE = `{"t": 1761297240.1, "take": "robot-A-20261024-0914", "kind": "attempt", "robot": "robot-A", "attempt": 1, "subject": "Beaker of steel hex nuts, 3 pieces."}
{"t": 1761297242.6, "take": "robot-A-20261024-0914", "kind": "call", "robot": "robot-A", "task": "plan", "via": "mubit", "ms": 2510, "sent": {"user": "Scene: …"}, "got": {"tilt_speed": 0.8, "…": "…"}}
{"t": 1761297242.6, "take": "robot-A-20261024-0914", "kind": "plan", "robot": "robot-A", "plan": {"arm_speed": 0.6, "pour_height_cm": 12, "tilt_speed": 0.8, "tilt_angle_deg": 120}}`;

export default function Takes() {
  const { st, actions } = useConsole();
  useTick(["robots", "source"]);
  const [over, setOver] = useState(false);
  const [showOffline, setShowOffline] = useState(prefs.showOffline());
  const input = useRef<HTMLInputElement>(null);
  const open = (f?: File | null) => { if (f) actions.openTake(f); };
  const runs = st.source.caps.includes("takes");
  const takes = [...st.takes].reverse();
  const firstEp = (take: string) => Object.values(st.episodes).filter((e) => e.take === take).sort((a, b) => a.start - b.start)[0];
  const imported = st.robots.filter((r) => r.imported);

  return (
    <>
      <PanelSub>{runs ? <><b>{st.takes.length}</b> takes · {st.takes.filter((t) => t.video).length} with video{st.takes.some((t) => t.live) ? " · one writing now" : ""}</> : imported.length ? <><b>{imported.length}</b> opened</> : "demo fleet"}</PanelSub>
      {runs && (
        <PanelActions>
          <label className="check" title="Offline (scripted) and fixture takes are never mixed into real robots; this hides them entirely.">
            <input type="checkbox" checked={showOffline} onChange={(e) => { setShowOffline(e.target.checked); setPref(prefs.PREF_OFFLINE, e.target.checked); location.reload(); }} /> Offline & fixture
          </label>
        </PanelActions>
      )}
      <div className={s.wrap}>
        {runs && (takes.length ? (
          <table className="tbl">
            <thead><tr><th>Take</th><th>Story</th><th>Mode</th><th>Checks</th><th /></tr></thead>
            <tbody>
              {takes.map((t) => {
                const ep = firstEp(t.id);
                return (
                  <tr key={t.id}>
                    <td><div className="mono">{t.id}</div><div className="subtle">{fmtClock(t.started - EPOCH)} · {t.events} events{t.live ? " · writing now" : ""}</div></td>
                    <td>{t.story}</td>
                    <td className="n">{t.mode}{t.offline ? " · offline" : ""}{t.fixture ? " · fixture" : ""}{t.video ? ` · video ${t.video.fps} fps` : ""}</td>
                    <td className="n">{t.verifier || "—"}</td>
                    <td>{ep ? <button className="btn sm" type="button" onClick={() => actions.replay(ep.robot, ep.id)}>Replay</button> : <span className="subtle">{showOffline ? "" : "hidden"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="empty">{st.source.note || "No takes yet."}</p>)}
        {actions.can.openTake && (
          <div
            className={`${s.drop}${over ? ` ${s.over}` : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); open(e.dataTransfer.files?.[0]); }}
          >
            <p>{runs ? "Open a take file that isn't in the runs dir:" : "Drop a take here, or"}</p>
            <button className="btn sm primary" type="button" onClick={() => input.current?.click()}>Choose a .jsonl file</button>
            <input ref={input} type="file" accept=".jsonl,.json,.txt,application/json" hidden onChange={(e) => { open(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        )}
        {!runs && imported.length > 0 && (
          <ul className={s.list}>
            {imported.map((r) => (
              <li key={r.id}>
                <span><b>{r.name}</b> · {r.env} · {r.history.length} attempt{r.history.length > 1 ? "s" : ""}</span>
                <button className="btn sm" type="button" onClick={() => actions.replay(r.id, r.history[0].id)}>Replay</button>
              </li>
            ))}
          </ul>
        )}
        <details className={s.fmt}><summary>Take format</summary><p>One JSON object per line, as Steward&apos;s EventLog writes them (steward/EVENTS.md). Attempts split on <code>attempt</code> events and group by <code>robot</code>. Isaac takes add <code>.mp4</code>, <code>.pov.mp4</code> and <code>.frames.json</code> beside the log.</p><pre>{SAMPLE}</pre></details>
      </div>
    </>
  );
}
