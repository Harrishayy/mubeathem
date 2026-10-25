"use client";

import { useEffect, useState } from "react";
import { useConsole } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { practiceStatus, startPractice, stopPractice } from "@/services/practice/client";
import type { PracticeStatus } from "@/services/types";
import s from "./practice.module.css";

export const meta: PanelMeta = { title: "Practice runs", minHeight: 200, needs: ["practice"], about: "Start and stop python -m steward.practice from here: the full loop on the text-only world, every plan, check and lesson a live call. The robots appear live on every tab." };

export default function Practice() {
  const { actions } = useConsole();
  const [stt, setStt] = useState<PracticeStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState(6);
  const [workers, setWorkers] = useState(2);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const x = await practiceStatus(); if (alive) { setStt(x); setErr(null); } } catch (e) { if (alive) setErr((e as Error).message); }
      if (alive) t = setTimeout(poll, stt?.running ? 1200 : 4000);
    };
    poll();
    return () => { alive = false; clearTimeout(t); };
  }, [stt?.running]);

  const live = !!stt?.canRunLive;
  const start = async () => {
    setBusy(true);
    try { setStt(await startPractice({ episodes, workers })); actions.toast(`Started ${episodes} practice episodes through Mubit.`, "Watch the fleet", () => actions.go("fleet")); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const stop = async () => { setBusy(true); try { setStt(await stopPractice()); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  return (
    <>
      <PanelSub>{stt?.running ? <><span className="pip" /> running · pid {stt.pid}</> : stt?.exitCode != null ? `last run exited ${stt.exitCode}` : "ready"}</PanelSub>
      <div className={s.wrap}>
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label>Episodes<input type="number" min={1} max={200} value={episodes} onChange={(e) => setEpisodes(Number(e.target.value))} /></label>
          <label>Workers<input type="number" min={1} max={8} value={workers} onChange={(e) => setWorkers(Number(e.target.value))} /></label>
          <div className={s.acts}>
            {stt?.running
              ? <button className="btn sm" type="button" onClick={stop} disabled={busy}>Stop the run</button>
              : <button className="btn sm primary" type="submit" disabled={busy || !live}>Start through Mubit</button>}
            <span className="subtle">{live ? "Live calls on your Mubit key." : "Set MUBIT_API_KEY in the repo's .env to run."} Lessons go to runs/practice-lessons.json.</span>
          </div>
        </form>
        {err && <p className={s.err}>{err}</p>}
        {stt && stt.output.length > 0 && <pre className={s.out} aria-label="Run output">{stt.output.join("\n")}</pre>}
      </div>
    </>
  );
}
