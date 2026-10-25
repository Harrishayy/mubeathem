// Small charts: latency sparklines with the point where an adapter took over.

export function LatSpark({ lat, w = 300, h = 30 }: { lat: { ms: number; serving: boolean }[]; w?: number; h?: number }) {
  if (lat.length < 2) return null;
  const max = Math.max(...lat.map((x) => x.ms)) * 1.1;
  const x = (i: number) => (i / (lat.length - 1)) * w, y = (v: number) => h - 2 - (v / max) * (h - 6);
  const pts = lat.map((l, i) => `${x(i).toFixed(1)},${y(l.ms).toFixed(1)}`);
  const sw = lat.findIndex((l) => l.serving);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ width: "100%", height: h, display: "block" }}>
      <path d={`M0,${h} L${pts.join(" L")} L${w},${h}Z`} fill="var(--fg)" fillOpacity=".07" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--fg)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      {sw > 0 && <line x1={x(sw)} x2={x(sw)} y1="0" y2={h} stroke="var(--ok)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
