/**
 * Time-sortable ids: `<prefix>_<10 chars of time><16 chars of randomness>` in Crockford base32,
 * the ULID layout. Lexical order matches creation order, including within one millisecond.
 */

export type IdPrefix = 'call' | 'turn' | 'sug' | 'line' | 'evt';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

export interface NewIdOptions {
  /** Epoch ms to encode. Defaults to `Date.now()`. */
  now?: number;
  /** Uniform [0, 1) source. Defaults to `crypto.getRandomValues`, then `Math.random`. */
  rng?: () => number;
}

let lastTime = -1;
let lastRand: number[] = [];

function encodeTime(ms: number): string {
  let t = Math.max(0, Math.floor(ms));
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function randomDigits(rng?: () => number): number[] {
  const digits: number[] = new Array(RAND_LEN);
  if (!rng && typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(RAND_LEN));
    for (let i = 0; i < RAND_LEN; i++) digits[i] = bytes[i]! % 32;
    return digits;
  }
  const r = rng ?? Math.random;
  for (let i = 0; i < RAND_LEN; i++) digits[i] = Math.min(31, Math.floor(r() * 32));
  return digits;
}

/** Increments base32 digits in place; returns false on overflow. */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i]! < 31) {
      digits[i]! += 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

/** A new time-sortable id such as `call_01J9Z6Q3K8M2X4T7V5B1N0C2D3`. Monotonic within one millisecond. */
export function newId(prefix: IdPrefix, opts: NewIdOptions = {}): string {
  const now = opts.now ?? Date.now();
  let rand: number[];
  if (opts.rng) {
    // Caller-controlled randomness is fully deterministic and skips the shared monotonic state.
    rand = randomDigits(opts.rng);
  } else if (now === lastTime && increment((rand = lastRand.slice()))) {
    lastRand = rand;
  } else {
    rand = randomDigits();
    lastTime = now;
    lastRand = rand;
  }
  return `${prefix}_${encodeTime(now)}${rand.map((d) => ALPHABET[d]).join('')}`;
}

/** The epoch ms encoded in an id made by `newId`, or null if it isn't one. */
export function idTime(id: string): number | null {
  const m = /^[a-z]+_([0-9A-HJKMNP-TV-Z]{10})[0-9A-HJKMNP-TV-Z]{16}$/.exec(id);
  if (!m) return null;
  let t = 0;
  for (const ch of m[1]!) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
