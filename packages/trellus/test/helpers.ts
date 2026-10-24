/** A clock whose sleep advances time instantly, so rate-limit and backoff timing is exact. */
export function fakeClock(startMs = Date.parse('2026-10-23T12:00:00Z')) {
  let t = startMs;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

export const OCT_20 = Date.parse('2026-10-20T00:00:00Z');
export const OCT_24 = Date.parse('2026-10-24T00:00:00Z');
