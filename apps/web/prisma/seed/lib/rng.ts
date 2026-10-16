/**
 * Seeded randomness. Every choice the seed makes goes through one of these
 * generators, so a re-run produces the same people, clubs and history (only
 * anchored to the current time).
 */

export type Rng = {
  next(): number;
  float(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (x: T) => number): T;
  shuffle<T>(arr: readonly T[]): T[];
  sample<T>(arr: readonly T[], k: number): T[];
  /** Weighted sampling without replacement (Efraimidis–Spirakis): returns items in draw order. */
  weightedOrder<T>(items: readonly T[], weight: (x: T) => number): T[];
  normal(mean: number, sd: number): number;
  poisson(lambda: number): number;
  string(alphabet: string, length: number): string;
};

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const rng: Rng = {
    next,
    float: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => {
      if (arr.length === 0) throw new Error("pick() from an empty list");
      return arr[Math.floor(next() * arr.length)];
    },
    weighted: (items, weight) => {
      const ws = items.map((x) => Math.max(0, weight(x)));
      const total = ws.reduce((a, b) => a + b, 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= ws[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle,
    sample: (arr, k) => shuffle(arr).slice(0, Math.max(0, k)),
    weightedOrder: (items, weight) =>
      items
        .map((x) => {
          const w = Math.max(1e-9, weight(x));
          return { x, k: Math.pow(next(), 1 / w) };
        })
        .sort((a, b) => b.k - a.k)
        .map((e) => e.x),
    normal: (mean, sd) => {
      const u = Math.max(1e-12, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.normal(0, 1)));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    string: (alphabet, length) => {
      let s = "";
      for (let i = 0; i < length; i++) s += alphabet[Math.floor(next() * alphabet.length)];
      return s;
    },
  };
  return rng;
}

/** cuid-shaped ids from their own stream, so ids are stable for the same data. */
export function createIdFactory(seed: number) {
  const next = mulberry32(seed);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const seen = new Set<string>();
  return () => {
    for (;;) {
      let s = "c";
      for (let i = 0; i < 24; i++) s += alphabet[Math.floor(next() * alphabet.length)];
      if (!seen.has(s)) {
        seen.add(s);
        return s;
      }
    }
  };
}
