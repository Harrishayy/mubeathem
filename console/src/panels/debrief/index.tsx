"use client";

import { useEffect, useRef, useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { fmtP } from "@/engine/format";
import { selectedEpisode } from "@/engine/state";
import { autoRead, suggestions, ask, detectSource, stripFix } from "@/engine/assistant";
import type { ChatItem, Episode, Fix } from "@/engine/types";
import s from "./debrief.module.css";

export const meta: PanelMeta = { title: "Debrief", minHeight: 260, mobileHeight: "520px", about: "A conversation about the selected episode. Asking for a fix gives an editable proposal you can add to lessons or re-run." };

const SOURCE_LABEL = { claude: "Claude, using only this episode's log", mubit: "Mubit's gateway, using only this episode's log", log: "replies built from this episode's log" };

/** Turn times like "6.4 s" into buttons that seek the replay. */
function Answer({ text, ep, onSeek }: { text: string; ep: Episode; onSeek: (t: number) => void }) {
  const clean = stripFix(text);
  const parts: React.ReactNode[] = [];
  const re = /\b(?:at\s)?(\d{1,3}(?:\.\d{1,2})?)\s?s\b/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(clean))) {
    const n = Number(m[1]);
    if (n > ep.duration + 0.5) continue;
    parts.push(clean.slice(last, m.index));
    parts.push(<button key={k++} type="button" className={s.t} onClick={() => onSeek(n)}>{m[0]}</button>);
    last = m.index + m[0].length;
  }
  parts.push(clean.slice(last));
  return <>{parts}</>;
}

export default function Debrief() {
  const { st, store, actions } = useConsole();
  useTick(["select", "chat"]);
  const ep = selectedEpisode(st);
  const [source, setSource] = useState<"claude" | "mubit" | "log">("log");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const msgs = useRef<HTMLDivElement>(null);

  useEffect(() => { detectSource().then(setSource); }, []);
  const chat = ep ? (st.chats[ep.id] ||= { items: [{ role: "read", text: autoRead(st, ep) }] }) : null;
  useEffect(() => { msgs.current?.scrollTo({ top: msgs.current.scrollHeight }); });

  if (!ep || !chat) return <p className="empty">Pick a robot to talk through an episode.</p>;
  const r = st.byId[ep.robot];
  const changed = () => store.emit("chat", ep.id);

  async function submit(q: string) {
    if (busy || !ep || !chat || !q.trim()) return;
    chat.items.push({ role: "user", text: q.trim() });
    const convo = chat.items.filter((m) => m.role === "user" || m.role === "assistant");
    const msg: ChatItem = { role: "assistant", text: "", pending: true };
    chat.items.push(msg);
    setBusy(true); changed();
    ctl.current = new AbortController();
    const res = await ask(st, ep, convo, { signal: ctl.current.signal, onText: (text) => { msg.text = text; msg.pending = false; changed(); } });
    Object.assign(msg, { text: res.text, pending: false, offline: !!res.offline, note: res.note || "", via: res.via });
    if (res.fix) chat.items.push({ role: "fix", fix: res.fix });
    ctl.current = null; setBusy(false); changed();
  }
  const sim = st.source.caps.includes("sim");
  async function act(f: Fix, what: "add" | "rerun" | "dismiss") {
    if (!ep) return;
    if (what === "dismiss") { f.status = "dismissed"; changed(); return; }
    const text = f.lesson.trim() || `Set ${f.param} to ${fmtP(f.param, f.value)}.`;
    if (what === "add") {
      const id = await actions.addLesson({ task: ep.task, text, applies_to: f.applies_to, settings: { [f.param]: f.value } }, ep);
      if (!id) return;
      f.lessonId = id; f.status = "added";
      actions.toast(sim ? `Added ${id} to fleet lessons.` : `Added ${id} to runs/practice-lessons.json. Running robots recall it from their next attempt.`, "View lessons", () => actions.go("lessons"));
    }
    if (what === "rerun") {
      f.lesson = text;
      if (await actions.rerun(ep, f)) f.status = "queued";
    }
    changed();
  }

  return (
    <>
      <PanelSub>{SOURCE_LABEL[source]}</PanelSub>
      <div className={s.wrap}>
        <div ref={msgs} className={s.msgs} aria-live="polite">
          {chat.items.map((m, i) => {
            if (m.role === "fix") {
              const f = m.fix;
              return (
                <div key={i} className={s.fix}>
                  <div className="eyebrow">Proposed fix</div>
                  <div className={s.chg}><span>{f.param}</span><s>{fmtP(f.param, ep.plan[f.param])}</s><span>→</span><b>{fmtP(f.param, f.value)}</b></div>
                  <div className="chips">{f.applies_to.map((w) => <span key={w} className="chip">{w}</span>)}</div>
                  <textarea aria-label="Lesson text" defaultValue={f.lesson} disabled={f.status !== "open"} onChange={(e) => { f.lesson = e.target.value; }} />
                  {f.status === "open" ? (
                    <div className={s.acts}>
                      {actions.can.addLesson && <button className="btn sm primary" type="button" onClick={() => act(f, "add")}>Add to fleet lessons</button>}
                      {actions.can.rerun && !r.imported && <button className="btn sm" type="button" onClick={() => act(f, "rerun")}>{sim ? `Re-run ${r.name} with this fix` : "Add it and start a practice run"}</button>}
                      <button className="btn sm ghost" type="button" onClick={() => act(f, "dismiss")}>Dismiss</button>
                    </div>
                  ) : (
                    <div className={s.done}>{f.status === "added" ? `Added as ${f.lessonId}. Robots recall it when two of its words match their task.` : f.status === "queued" ? (sim ? `${r.name} runs this subject next with ${f.param} ${fmtP(f.param, f.value)}.` : "Added to the fleet lessons, and a practice run started. Watch it on the Fleet tab.") : "Dismissed."}</div>
                  )}
                </div>
              );
            }
            const who = m.role === "user" ? "You" : m.role === "read" ? "Steward's read" : m.offline ? "Steward · from the log" : m.via === "mubit" ? "Mubit" : "Claude";
            return (
              <div key={i} className={`${s.msg} ${m.role === "user" ? s.user : m.role === "read" ? s.read : ""}`}>
                <div className={s.who}>{who}</div>
                <div className={s.body}>{m.pending && !m.text ? <span className={s.thinking}>Thinking</span> : m.role === "user" ? m.text : <Answer text={m.text} ep={ep} onSeek={actions.seek} />}</div>
                {m.note && <div className={s.note}>{m.note}</div>}
              </div>
            );
          })}
        </div>
        {!busy && <div className={s.sugg}>{suggestions(ep).map((q) => <button key={q} type="button" onClick={() => submit(q)}>{q}</button>)}</div>}
        <form className={s.ask} onSubmit={(e) => { e.preventDefault(); const q = draft; setDraft(""); submit(q); }}>
          <textarea rows={1} value={draft} placeholder="Ask why it went wrong, or what to change" aria-label="Ask about this episode"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          {busy ? <button className="btn sm" type="button" onClick={() => ctl.current?.abort()}>Stop</button> : <button className="btn sm primary" type="submit">Send</button>}
        </form>
      </div>
    </>
  );
}
