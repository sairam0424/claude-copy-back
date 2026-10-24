// Seeded random numbers for the ground-truth generator. A private copy on
// purpose: the generator must share no code with the matcher or the simulator.

/** mulberry32: small, fast, good enough for test data. Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix two integers into one seed (so each message and each width gets its own stream). */
export function mixSeed(a, b) {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  /** Integer in [lo, hi], both inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  /** Log-uniform integer in [lo, hi]: short and long values are about equally likely per decade. */
  logInt(lo, hi) {
    return Math.round(Math.exp(Math.log(lo) + this.next() * (Math.log(hi) - Math.log(lo))));
  }

  shuffled(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
