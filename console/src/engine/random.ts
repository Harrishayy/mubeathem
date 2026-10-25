// Seeded randomness for the simulated fleet, so a fresh load starts from the same history.

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

export function makeRng(seed = 20261024) {
  const rng = mulberry32(seed);
  return {
    next: rng,
    gauss() { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); },
    pick<T>(arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; },
    rid() { return "req_" + Array.from({ length: 12 }, () => "0123456789abcdef"[Math.floor(rng() * 16)]).join(""); },
  };
}

/** Stable per-particle noise for drawing, independent of the simulation's rng. */
export const hsh = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
