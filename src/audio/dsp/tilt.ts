/**
 * TILT — redistribute energy between low and high frequencies.
 *
 * Applies a spectral slope pivoting at ~1 kHz: tilt > 0 brightens, tilt < 0
 * darkens. The slope is bounded to ±12 dB/octave at the extremes and the total
 * energy is preserved afterwards so tilting does not change perceived loudness.
 */
const PIVOT_HZ = 1000
const MAX_SLOPE_DB_PER_OCT = 12

export function applyTilt(
  mag: Float32Array,
  tilt: number,
  out: Float32Array,
  sampleRate: number,
  fftSize: number,
): void {
  const n = out.length
  if (tilt === 0) {
    out.set(mag)
    return
  }
  const binHz = sampleRate / fftSize
  const slopeDbPerOct = tilt * MAX_SLOPE_DB_PER_OCT
  const k = slopeDbPerOct / 20 // dB→amplitude exponent against log2(f/pivot)
  let ein = 0
  let eout = 0
  for (let i = 0; i < n; i++) {
    const f = i * binHz
    let g: number
    if (f <= 0) {
      g = Math.pow(2, k * Math.log2((0.5 * binHz) / PIVOT_HZ))
    } else {
      g = Math.pow(2, k * Math.log2(f / PIVOT_HZ))
    }
    // Bound the gain so a degenerate spectrum can't explode.
    if (g > 16) g = 16
    else if (g < 1 / 16) g = 1 / 16
    const m = mag[i] * g
    out[i] = m
    ein += mag[i] * mag[i]
    eout += m * m
  }
  if (eout > 1e-12 && ein > 0) {
    const norm = Math.sqrt(ein / eout)
    for (let i = 0; i < n; i++) out[i] *= norm
  }
}
