// Banyan Sapling's answer, drawn the same everywhere: the verdict, and its calibrated
// probability for each of the four labels, outlining the labels in its prediction set.

import { Verdict } from "./status";
import s from "./sapling.module.css";

export const SAPLING_LABELS = ["supported", "violation", "insufficient_information", "inconsistent_context"];

export function SaplingBars({ got }: { got: { status?: string; raw_label?: string; prediction_set?: string[]; probabilities?: Record<string, number> } }) {
  const p = got.probabilities || {}, set = got.prediction_set || [];
  return (
    <>
      <p className={s.why}>
        {got.status === "unsure"
          ? <><Verdict label={got.raw_label || "supported"} status="unsure" /> Its prediction set holds {set.length} labels, so Steward treats this as unsure and stops.</>
          : <><Verdict label={got.status || "supported"} /> A single-label prediction set: decided.</>}
      </p>
      <div className={s.probs} role="table" aria-label="Calibrated probabilities">
        {SAPLING_LABELS.map((l) => {
          const v = typeof p[l] === "number" ? p[l] : 0;
          return (
            <div key={l} role="row" className={set.includes(l) ? s.inset : ""}>
              <span role="cell"><Verdict label={l} /></span>
              <span role="cell" className={s.track}><i style={{ width: `${Math.round(v * 100)}%` }} className={l === "supported" ? s.ok : l === "violation" ? s.bad : s.mid} /></span>
              <span role="cell" className="mono">{(v * 100).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      <p className={s.foot}>Outlined: the labels in Sapling&apos;s prediction set{got.raw_label ? ` (raw label ${got.raw_label})` : ""}.</p>
    </>
  );
}
