// A small seeded random source, so a synthetic corpus can be regenerated exactly.

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A uniform number in [0, 1). The generator is mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(low: number, high: number): number {
    return low + (high - low) * this.next();
  }

  /** A whole number from low to high, both included. */
  int(low: number, high: number): number {
    return Math.floor(this.uniform(low, high + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** A normal sample, by the Box-Muller transform. */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A log-normal sample with the given median. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  /** Picks an index with probability proportional to its weight. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }
}
