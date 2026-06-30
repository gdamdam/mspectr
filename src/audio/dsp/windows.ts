/**
 * Analysis/synthesis windows and overlap-add normalization.
 *
 * mspectr uses a Hann window on BOTH analysis and synthesis with a hop of
 * fftSize/4 (75% overlap). The product of the two windows is Hann², which
 * satisfies the Constant-Overlap-Add (COLA) condition at that hop, so the
 * overlap-add reconstruction has flat gain. `overlapNormalization` returns the
 * exact per-output-sample weight sum so resynthesis stays unity-gain even at
 * other hop sizes.
 */

/** Periodic Hann window of length `size`. */
export function hann(size: number): Float32Array {
  const w = new Float32Array(size)
  if (size === 1) {
    w[0] = 1
    return w
  }
  const scale = (2 * Math.PI) / size
  for (let n = 0; n < size; n++) {
    w[n] = 0.5 - 0.5 * Math.cos(scale * n)
  }
  return w
}

/** Square-root Hann — useful when only one side should carry the Hann shape. */
export function sqrtHann(size: number): Float32Array {
  const w = hann(size)
  for (let n = 0; n < size; n++) w[n] = Math.sqrt(w[n])
  return w
}

/** Multiply a frame by a window in place. */
export function applyWindow(frame: Float32Array, window: Float32Array): void {
  const n = Math.min(frame.length, window.length)
  for (let i = 0; i < n; i++) frame[i] *= window[i]
}

/**
 * Per-output-sample overlap-add weight: Σ over all frames overlapping output
 * sample `n` of window[n - frameStart]². The pattern is periodic with period
 * `hop`, so we return an array of length `hop`. overlapAdd divides each output
 * sample by `norm[t % hop]` to achieve unity gain. Values are floored away from
 * zero to avoid division blow-ups.
 */
export function overlapNormalization(window: Float32Array, hop: number): Float32Array {
  const size = window.length
  const norm = new Float32Array(hop)
  for (let r = 0; r < hop; r++) {
    let sum = 0
    // Sample indices congruent to r (mod hop) that fall within the window.
    for (let k = r; k < size; k += hop) {
      sum += window[k] * window[k]
    }
    norm[r] = sum > 1e-8 ? sum : 1
  }
  return norm
}
