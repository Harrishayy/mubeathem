"use client";

// Small controls shared by panels.

import { useEffect, useRef } from "react";
import { useFrame } from "@/console/hooks";
import { drawScene } from "@/engine/scene";
import { STATUS_LABEL } from "@/engine/text";
import type { Episode, Robot } from "@/engine/types";

/** A segmented control. */
export function Seg<T extends string | number>({ options, value, onChange, label, size = "sm" }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md";
}) {
  return (
    <div className={`seg${size === "sm" ? " sm" : ""}`} role="group" aria-label={label}>
      {options.map((o) => <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** One bar per episode, oldest first. Outline = running now. */
export function EpisodeStrip({ eps, live, onPick, max = 18 }: { eps: Episode[]; live?: Episode | null; onPick?: (id: string) => void; max?: number }) {
  return (
    <div className="estrip">
      {eps.slice(-max).map((e) => (
        <button key={e.id} type="button" className={`eq ${e.outcome}`} title={`#${e.n} · ${STATUS_LABEL[e.outcome]} · ${e.variant.subject}`} aria-label={`Episode ${e.n}, ${STATUS_LABEL[e.outcome]}`}
          onClick={(ev) => { ev.stopPropagation(); onPick?.(e.id); }} />
      ))}
      {live && <button type="button" className="eq live" title={`#${live.n} · running now`} aria-label={`Episode ${live.n}, running now`} onClick={(ev) => { ev.stopPropagation(); onPick?.("live"); }} />}
    </div>
  );
}

/** A canvas that redraws an episode every frame while it is on screen. */
export function SceneCanvas({ source, minimal = false, label }: { source: () => { ep: Episode | null; t: number; robot?: Robot } | null; minimal?: boolean; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const visible = useRef(true);
  const src = useRef(source);
  src.current = source;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useFrame(() => {
    if (!visible.current || !ref.current) return;
    const s = src.current();
    if (s) drawScene(ref.current, s.ep, s.t, s.robot, minimal);
  });
  return <canvas ref={ref} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
