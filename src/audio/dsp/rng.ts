/**
 * Deterministic pseudo-random generator for DSP. A seeded xorshift32 keeps
 * phase motion, randomized partial drift, and any stochastic behaviour fully
 * reproducible — the same seed always yields the same sound, which the tests
 * and patch sharing rely on. Never use Math.random() in audio code.
 */
export class Xorshift32 {
  private state: number

  constructor(seed: number) {
    // Avoid the zero fixed point; keep it a non-zero uint32.
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed >>> 0
  }

  /** Reset to a seed so a freeze/voice can be made reproducible on demand. */
  reseed(seed: number): void {
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed >>> 0
  }

  /** Next uint32. */
  nextUint32(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000
  }

  /** Uniform float in [-1, 1). */
  nextBipolar(): number {
    return this.nextFloat() * 2 - 1
  }
}
