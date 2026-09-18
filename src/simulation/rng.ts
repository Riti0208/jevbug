/**
 * Seeded pseudo random number generator (spec §27).
 * sfc32 — fast, good quality, 32-bit state, deterministic across platforms.
 *
 * All randomness in the simulation MUST come from an instance of this class.
 * Use `fork(label)` to derive independent streams per subsystem so that adding
 * randomness in one system does not perturb another.
 */
export class SeededRandom {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private gaussianSpare: number | null = null;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // splitmix-like seeding to fill state
    let x = (s ^ 0x9e3779b9) >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Standard normal via Marsaglia polar method. */
  gaussian(mean = 0, stdDev = 1): number {
    if (this.gaussianSpare !== null) {
      const v = this.gaussianSpare;
      this.gaussianSpare = null;
      return mean + stdDev * v;
    }
    let u: number, v: number, s: number;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.gaussianSpare = v * mul;
    return mean + stdDev * u * mul;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() on empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Weighted sampling over a probability map (spec §8: sample, don't argmax).
   * Negative/NaN weights are treated as 0. If all weights are 0, picks uniformly.
   */
  weighted<K extends string>(probabilities: Record<K, number>): K {
    const keys = Object.keys(probabilities) as K[];
    let total = 0;
    for (const k of keys) {
      const w = probabilities[k];
      if (Number.isFinite(w) && w > 0) total += w;
    }
    if (total <= 0) return this.pick(keys);
    let r = this.next() * total;
    for (const k of keys) {
      const w = probabilities[k];
      if (!(Number.isFinite(w) && w > 0)) continue;
      r -= w;
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }

  /** In-place Fisher–Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Derive an independent generator. Deterministic for the same (state, label). */
  fork(label: string): SeededRandom {
    return new SeededRandom((this.nextUint32() ^ hashString(label)) >>> 0);
  }

  /** Random alphanumeric token, e.g. for signal relabeling (spec §35). */
  token(length = 3, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
    let s = '';
    for (let i = 0; i < length; i++) s += alphabet[Math.floor(this.next() * alphabet.length)];
    return s;
  }
}

export function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
