/**
 * BLUR — smooth spectral energy across neighbouring bins.
 *
 * A sliding box average whose radius scales with `amount`, bounded so that even
 * at full blur the spectrum keeps gross structure rather than instantly
 * flattening into featureless noise. Runs in O(n) with no allocation (a running
 * window sum). Energy is preserved so blur does not change loudness.
 */
import { clamp } from '../contracts'

/** Largest blur radius is binCount/MAX_RADIUS_DIVISOR — keeps blur musical. */
const MAX_RADIUS_DIVISOR = 24

export function blurRadius(binCount: number, amount: number): number {
  const maxR = Math.max(1, Math.floor(binCount / MAX_RADIUS_DIVISOR))
  return Math.round(clamp(amount, 0, 1) * maxR)
}

export function applyBlur(mag: Float32Array, amount: number, out: Float32Array): void {
  const n = mag.length
  const r = blurRadius(n, amount)
  if (r <= 0) {
    out.set(mag)
    return
  }
  const width = 2 * r + 1
  // Initialise the window sum for index 0: bins [-r, r] clamped to [0, n-1].
  let sum = 0
  for (let j = -r; j <= r; j++) {
    sum += mag[clampIndex(j, n)]
  }
  let ein = 0
  let eout = 0
  for (let i = 0; i < n; i++) {
    const m = sum / width
    out[i] = m
    ein += mag[i] * mag[i]
    eout += m * m
    // Slide the window to i+1: drop (i-r), add (i+1+r), both clamped.
    sum += mag[clampIndex(i + 1 + r, n)] - mag[clampIndex(i - r, n)]
  }
  if (eout > 1e-12 && ein > 0) {
    const norm = Math.sqrt(ein / eout)
    for (let i = 0; i < n; i++) out[i] *= norm
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i
}
