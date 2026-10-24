/** Display formatting shared by every client. */

/** "02:14" under an hour, "1:02:14" from an hour; negative or non-finite input reads "00:00". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** A 0..1 ratio as a whole percentage ("41%"); clamps to 0–100. */
export function formatPercent(x: number): string {
  if (!Number.isFinite(x)) return '0%';
  return `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`;
}

/** A ratio as a multiplier: one decimal below 10 ("2.1×"), whole from 10 ("12×"). */
export function formatMultiplier(x: number): string {
  if (!Number.isFinite(x) || x < 0) return '0×';
  if (x >= 10) return `${Math.round(x)}×`;
  return `${(Math.round(x * 10) / 10).toFixed(1)}×`;
}

/** The first `n` words of `text`, with an ellipsis when anything was cut. */
export function truncateWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(' ');
  const cut = words.slice(0, Math.max(0, n)).join(' ').replace(/[,;:.!?\-–—]+$/, '');
  return `${cut}…`;
}
