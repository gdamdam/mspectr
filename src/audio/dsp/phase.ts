/**
 * Phase utilities for resynthesis.
 *
 * For steady overlap-add resynthesis of a (near-)static magnitude spectrum, each
 * bin's phase must advance every hop by the nominal phase increment of a
 * sinusoid sitting at that bin. For an N-point FFT, bin k corresponds to
 * frequency k·sr/N, so the per-hop increment is 2π·k·hop/N — independent of the
 * sample rate, which keeps behaviour identical across 44.1/48/96 kHz contexts.
 * Multiplying by a pitch ratio transposes the resynthesized spectrum.
 */
import { Xorshift32 } from './rng'

export const TWO_PI = Math.PI * 2

/** Wrap a phase into (-π, π]. */
export function wrapPhase(p: number): number {
  let x = p % TWO_PI
  if (x > Math.PI) x -= TWO_PI
  else if (x <= -Math.PI) x += TWO_PI
  return x
}

/**
 * Base per-hop phase increments 2π·k·hop/N for every bin. Multiply by a voice's
 * pitch ratio at synthesis time to get its actual advance.
 */
export function baseBinOmega(binCount: number, fftSize: number, hop: number): Float32Array {
  const omega = new Float32Array(binCount)
  const step = (TWO_PI * hop) / fftSize
  for (let k = 0; k < binCount; k++) omega[k] = step * k
  return omega
}

/**
 * Seeded per-bin phase-drift offsets for the 'animate' freeze mode. Returns a
 * function producing a small bounded random increment per call so a frozen
 * spectrum keeps shimmering without buzzing. Deterministic for a given seed.
 */
export function makePhaseDrift(seed: number): (amount: number) => number {
  const rng = new Xorshift32(seed)
  return (amount: number) => rng.nextBipolar() * amount
}
