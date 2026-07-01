import { describe, expect, it } from 'vitest'
import { morphSpectra, spectralEnergy } from './morph'

const allFinite = (a: Float32Array) => a.every((v) => Number.isFinite(v))
const allNonNeg = (a: Float32Array) => a.every((v) => v >= 0)

/** Spectral centroid (energy-weighted mean bin) — larger = brighter. */
function centroid(mag: Float32Array): number {
  let num = 0
  let den = 0
  for (let k = 0; k < mag.length; k++) {
    const p = mag[k] * mag[k]
    num += k * p
    den += p
  }
  return den > 0 ? num / den : 0
}

/** Build a smooth spectrum with a single broad Gaussian hump at `center`. */
function hump(n: number, center: number, width: number, peak = 1): Float32Array {
  const out = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const d = (k - center) / width
    out[k] = peak * Math.exp(-0.5 * d * d)
  }
  return out
}

describe('morphSpectra', () => {
  const N = 64

  it('reproduces endpoints at t=0 and t=1', () => {
    const a = hump(N, 12, 5, 1.3)
    const b = hump(N, 48, 8, 0.7)
    const out = new Float32Array(N)
    const s1 = new Float32Array(N)
    const s2 = new Float32Array(N)

    morphSpectra(a, b, 0, out, s1, s2)
    for (let k = 0; k < N; k++) expect(out[k]).toBeCloseTo(a[k], 5)

    morphSpectra(a, b, 1, out, s1, s2)
    for (let k = 0; k < N; k++) expect(out[k]).toBeCloseTo(b[k], 5)
  })

  it('does not collapse loudness at the midpoint of disjoint-peak spectra', () => {
    // Two narrow peaks in different bins — the classic case where a linear
    // blend halves the energy at the midpoint.
    const a = hump(N, 10, 2, 1)
    const b = hump(N, 50, 2, 1)
    const out = new Float32Array(N)
    const s1 = new Float32Array(N)
    const s2 = new Float32Array(N)

    morphSpectra(a, b, 0.5, out, s1, s2)

    const ea = spectralEnergy(a)
    const eb = spectralEnergy(b)
    const target = 0.5 * ea + 0.5 * eb
    const eo = spectralEnergy(out)
    // Energy tracks the lerp of endpoint energies (loudness-preserving).
    expect(eo).toBeCloseTo(target, 3)
    // Sanity: no severe dip — at least most of the target energy survives.
    expect(eo).toBeGreaterThan(0.9 * target)
  })

  it('is finite and non-negative across t', () => {
    const a = hump(N, 8, 4, 1.5)
    const b = hump(N, 55, 6, 0.5)
    const out = new Float32Array(N)
    const s1 = new Float32Array(N)
    const s2 = new Float32Array(N)
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      morphSpectra(a, b, t, out, s1, s2)
      expect(allFinite(out)).toBe(true)
      expect(allNonNeg(out)).toBe(true)
    }
  })

  it('glides the centroid monotonically from a dark to a bright spectrum', () => {
    // Dark = energy low in the spectrum; bright = energy high.
    const dark = hump(N, 10, 6, 1)
    const bright = hump(N, 52, 6, 1)
    const out = new Float32Array(N)
    const s1 = new Float32Array(N)
    const s2 = new Float32Array(N)

    morphSpectra(dark, bright, 0, out, s1, s2)
    const c0 = centroid(out)
    morphSpectra(dark, bright, 0.5, out, s1, s2)
    const c05 = centroid(out)
    morphSpectra(dark, bright, 1, out, s1, s2)
    const c1 = centroid(out)

    // Envelope glide: centroid moves strictly upward across 0 -> 0.5 -> 1.
    expect(c05).toBeGreaterThan(c0)
    expect(c1).toBeGreaterThan(c05)
  })

  it('handles zero and near-zero envelopes without NaN (divide-by-zero guard)', () => {
    const a = new Float32Array(N) // all zeros
    const b = hump(N, 30, 5, 1)
    const out = new Float32Array(N)
    const s1 = new Float32Array(N)
    const s2 = new Float32Array(N)
    morphSpectra(a, b, 0.5, out, s1, s2)
    expect(allFinite(out)).toBe(true)
    expect(allNonNeg(out)).toBe(true)
  })
})
