/**
 * Frequency-domain remapping primitives.
 *
 *  - `resampleSpectrum`  multiplicative resampling of the magnitude axis by a
 *    pitch ratio. Used for musical transposition (note pitch) and for the
 *    harmonizer's interval voices. newMag[k] = mag[k / ratio], interpolated;
 *    bins reading out of range are zero.
 *
 *  - `applyFreqShift`    ADDITIVE frequency shift by a (possibly fractional)
 *    bin offset. Moving every partial by a constant number of Hz breaks the
 *    harmonic ratios, giving an inharmonic/metallic character that is audibly
 *    distinct from transposition — this is the SHIFT control. out[k] reads from
 *    mag[k - shiftBins].
 */
export function resampleSpectrum(mag: Float32Array, ratio: number, out: Float32Array): void {
  const n = out.length
  if (ratio <= 0 || !Number.isFinite(ratio)) {
    out.fill(0)
    return
  }
  if (ratio === 1) {
    out.set(mag)
    return
  }
  const invRatio = 1 / ratio
  for (let k = 0; k < n; k++) {
    const src = k * invRatio
    const i = Math.floor(src)
    if (i < 0 || i >= n - 1) {
      out[k] = i >= 0 && i === n - 1 ? mag[n - 1] : 0
      continue
    }
    const frac = src - i
    out[k] = mag[i] * (1 - frac) + mag[i + 1] * frac
  }
}

export function applyFreqShift(mag: Float32Array, shiftBins: number, out: Float32Array): void {
  const n = out.length
  if (shiftBins === 0) {
    out.set(mag)
    return
  }
  for (let k = 0; k < n; k++) {
    const src = k - shiftBins
    const i = Math.floor(src)
    if (i < 0 || i >= n - 1) {
      out[k] = i === n - 1 ? mag[n - 1] : 0
      continue
    }
    const frac = src - i
    out[k] = mag[i] * (1 - frac) + mag[i + 1] * frac
  }
}

/** Convert a SHIFT control value (semitone-scaled, -24..24) to a bin offset. */
export function shiftBinsFor(shift: number, sampleRate: number, fftSize: number): number {
  // Map the control to a linear Hz offset: full ±24 → ±1000 Hz inharmonic shift.
  const hz = (shift / 24) * 1000
  return (hz * fftSize) / sampleRate
}
