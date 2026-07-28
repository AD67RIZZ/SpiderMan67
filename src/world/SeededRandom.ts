export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small, deterministic and platform-stable PRNG for course generation. */
export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    this.state = hashSeed(seed) || 0x6d2b79f5;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    const value = items[Math.min(items.length - 1, this.int(0, items.length - 1))];
    if (value === undefined) {
      throw new Error('Cannot choose from an empty collection.');
    }
    return value;
  }

  sign(): -1 | 1 {
    return this.next() < 0.5 ? -1 : 1;
  }
}
