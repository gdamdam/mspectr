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

/**
 * Fill `peaks` with the bin indices of local magnitude maxima and return the
 * peak count. A bin qualifies if it is strictly greater than its two neighbours
 * on each side and sits above a small relative floor (a fraction of the frame's
 * peak magnitude) — this rejects sub-noise-floor wiggles that would otherwise
 * fragment a partial into spurious "peaks". Edge bins (fewer than two neighbours
 * on a side) are never reported. The caller owns `peaks`; its length must be at
 * least mag.length. No allocation.
 */
export function findSpectralPeaks(mag: Float32Array, peaks: Int32Array): number {
  const n = mag.length
  // Relative floor keyed off the frame maximum: a partial worth locking is a
  // meaningful fraction of the spectrum's energy, not a rounding-error ripple.
  let maxMag = 0
  for (let k = 0; k < n; k++) {
    const m = mag[k]
    if (m > maxMag) maxMag = m
  }
  if (maxMag <= 0) return 0
  const floor = maxMag * 1e-4

  let count = 0
  // Need two neighbours each side, so scan [2, n-3].
  for (let k = 2; k < n - 2; k++) {
    const m = mag[k]
    if (m <= floor) continue
    if (m > mag[k - 1] && m > mag[k - 2] && m > mag[k + 1] && m > mag[k + 2]) {
      peaks[count++] = k
    }
  }
  return count
}

/**
 * In place: lock each bin's phase to the phase of its nearest spectral peak so a
 * partial's bins stay phase-coherent (Laroche & Dolson identity phase-locking).
 * Each bin is assigned to the peak whose region of influence it falls in, with
 * boundaries at the midpoints between adjacent peaks; that bin's phase is then
 * copied from the peak bin. `peaks`/`peakCount` come from findSpectralPeaks and
 * `peaks` must be ascending (as findSpectralPeaks produces). No-op if
 * peakCount === 0. No allocation.
 */
export function lockPhasesToPeaks(
  phase: Float32Array,
  mag: Float32Array,
  peaks: Int32Array,
  peakCount: number,
): void {
  // mag is part of the documented signature (region of influence is a magnitude
  // notion) but the assignment is purely positional given ascending peaks.
  void mag
  if (peakCount <= 0) return

  const n = phase.length
  let p = 0
  // Upper bin (inclusive) of the current peak's region: the midpoint to the next
  // peak, or the last bin for the final peak.
  let boundary =
    peakCount > 1 ? (peaks[0] + peaks[1]) >> 1 : n - 1
  let peakPhase = phase[peaks[0]]

  for (let k = 0; k < n; k++) {
    // Advance to the peak owning this bin. `boundary` is the last bin of the
    // current peak's region; once past it, move to the next peak.
    while (k > boundary && p < peakCount - 1) {
      p++
      peakPhase = phase[peaks[p]]
      boundary =
        p < peakCount - 1 ? (peaks[p] + peaks[p + 1]) >> 1 : n - 1
    }
    phase[k] = peakPhase
  }
}
