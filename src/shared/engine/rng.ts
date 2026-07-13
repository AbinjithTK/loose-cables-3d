/**
 * Deterministic seeded pseudo-random number generator (mulberry32).
 *
 * Small, fast, and good enough for level generation. Being deterministic is
 * essential: the daily puzzle derives its seed from the date so every player
 * worldwide gets the identical board, and generated levels are reproducible
 * for debugging.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero 32-bit state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Picks a random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Fisher-Yates shuffle returning a new array (does not mutate input). */
  shuffle<T>(items: readonly T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = result[i]!;
      result[i] = result[j]!;
      result[j] = tmp;
    }
    return result;
  }
}

/**
 * Hashes an arbitrary string to a 32-bit unsigned integer (FNV-1a).
 * Used to derive a numeric seed from a date string like "2026-07-10".
 */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
