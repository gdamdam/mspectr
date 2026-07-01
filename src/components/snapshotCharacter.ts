/**
 * snapshotCharacter — a tiny, human-readable "character" tag for a captured
 * spectrum, e.g. "bright · airy". Pure and deterministic so it can label slots
 * without touching the engine.
 *
 * A snapshot's magnitude may be a multi-frame frame-major buffer (see
 * SpectralSnapshot in ../audio/contracts). The attack frame carries the
 * clearest identity, so we read only the FIRST frame (the first `binCount`
 * values) and describe it with two coarse, perceptual axes:
 *
 *  - brightness, from the normalized spectral centroid (dark / warm / bright / airy)
 *  - texture,    from the spectral flatness (tonal / rich / noisy)
 *
 * Everything is finite-safe: a missing, empty, or all-zero frame carries no
 * usable identity, so we return "quiet" rather than a misleading tag.
 */

/** Bin index below which a magnitude is treated as silence for flatness. */
const EPS = 1e-9

/**
 * Return a short two-word character tag from the first frame of a magnitude
 * buffer. `binCount` bounds the read so multi-frame buffers only ever expose
 * their attack frame.
 */
export function snapshotCharacter(magnitude: Float32Array, binCount: number): string {
  const n = Math.min(binCount | 0, magnitude.length)
  if (n <= 0) return 'quiet'

  // Single pass: total energy (Σ mag), weighted energy (Σ i·mag) for the
  // centroid, and log-sum for the geometric mean used by flatness.
  let sum = 0
  let weighted = 0
  let logSum = 0
  for (let i = 0; i < n; i++) {
    const m = magnitude[i]
    // Guard against NaN/Infinity leaking in from malformed buffers.
    const mag = Number.isFinite(m) && m > 0 ? m : 0
    sum += mag
    weighted += mag * i
    logSum += Math.log(mag + EPS)
  }

  if (sum <= EPS) return 'quiet'

  // Normalized spectral centroid, 0 (all energy in bin 0) .. 1 (top bin).
  // n === 1 has no spread, so it lands at the "warm" default below.
  const centroid = n > 1 ? weighted / sum / (n - 1) : 0

  // Spectral flatness = geometric mean / arithmetic mean, 0 (pure tone) .. 1
  // (white noise). The +EPS in logSum keeps zero bins finite.
  const geoMean = Math.exp(logSum / n)
  const arithMean = sum / n
  const flatness = arithMean > 0 ? geoMean / arithMean : 0

  return `${brightnessWord(centroid)} · ${textureWord(flatness)}`
}

function brightnessWord(centroid: number): string {
  if (centroid < 0.12) return 'dark'
  if (centroid < 0.3) return 'warm'
  if (centroid < 0.55) return 'bright'
  return 'airy'
}

function textureWord(flatness: number): string {
  if (flatness < 0.15) return 'tonal'
  if (flatness < 0.45) return 'rich'
  return 'noisy'
}
