"use client";

import { useEffect, useState } from "react";
import { useConsole } from "@/console/hooks";
import { PanelActions, PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { SOURCES } from "@/sources";
import { getHealth } from "@/services/health";
import type { HealthReport } from "@/services/types";
import s from "./services.module.css";

export const meta: PanelMeta = { title: "Services", minHeight: 220, about: "Every backend service the console is plugged into, its health and settings, and the data sources you can switch between." };

const STATUS = { ok: "Up", idle: "Idle", off: "Off", error: "Down" } as const;

export default function Services() {
  const { st, sourceId, switchSource } = useConsole();
  const [h, setH] = useState<HealthReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => getHealth().then((r) => { if (alive) { setH(r); setErr(null); } }).catch((e: Error) => alive && setErr(e.message));
    poll(); const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [n]);
  const up = h?.services.filter((x) => x.health.status === "ok").length ?? 0;
  return (
    <>
      <PanelSub>{h ? <><b>{up}</b> of {h.services.length} up · source <b>{st.source.label}</b></> : err ? "backend unreachable" : "checking…"}</PanelSub>
      <PanelActions><button className="btn sm" type="button" onClick={() => setN((x) => x + 1)}>Recheck</button></PanelActions>
      <div className={s.wrap}>
        <section>
          <h4>Data source</h4>
          <div className={s.sources}>
            {SOURCES.map((src) => (
              <button key={src.id} type="button" className={s.source} aria-pressed={src.id === sourceId} onClick={() => switchSource(src.id)}>
                <b>{src.label}</b><span>{src.about}</span><small className="mono">src/sources/{src.id} · {src.caps.join(" · ")}</small>
              </button>
            ))}
          </div>
          {st.source.note && <p className={s.note}>{st.source.note}</p>}
        </section>
        <section>
          <h4>Backend services <span>/api/&lt;id&gt; · src/services/&lt;id&gt;</span></h4>
          {err && <p className={s.err}>Couldn&apos;t reach /api/health: {err}. Is the console running with <code>pnpm dev</code> or <code>pnpm start</code>?</p>}
          <ul className={s.list}>
            {h?.services.map((x) => (
              <li key={x.id} className={s.svc}>
                <div className={s.svcHead}>
                  <span className={`${s.dot} ${s[x.health.status]}`} aria-hidden="true" />
                  <b>{x.label}</b><code>/api/{x.id}</code>
                  <span className="grow" />
                  <span className={`${s.state} ${s[x.health.status]}`}>{STATUS[x.health.status]}</span>
                </div>
                <p className={s.sum}>{x.health.summary}</p>
                <p className={s.about}>{x.about}</p>
                {x.env.length > 0 && <div className={s.env}>{x.env.map((v) => <span key={v.key} className={v.set ? s.set : ""} title={v.about}><code>{v.key}</code> {v.set ? (v.secret ? "set (hidden)" : "set") : "not set"}</span>)}</div>}
              </li>
            ))}
          </ul>
          {h && <p className={s.note}>Repo root {h.root}. Unplug a service by deleting its line in src/services/server/registry.ts, or list its id in STEWARD_SERVICES_OFF{h.disabled.length ? ` (now: ${h.disabled.join(", ")})` : ""}.</p>}
        </section>
      </div>
    </>
  );
}
