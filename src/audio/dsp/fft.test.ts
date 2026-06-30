import { describe, expect, it } from 'vitest'
import { FFT } from './fft'

function maxAbs(a: Float32Array): number {
  let m = 0
  for (const v of a) m = Math.max(m, Math.abs(v))
  return m
}

describe('FFT', () => {
  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(3)).toThrow()
    expect(() => new FFT(1000)).toThrow()
    expect(() => new FFT(0)).toThrow()
  })

  it('transforms a unit impulse to a flat spectrum', () => {
    const n = 64
    const fft = new FFT(n)
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    re[0] = 1
    fft.forward(re, im)
    // δ[n] → all bins equal to 1 (magnitude flat).
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(1, 5)
      expect(im[k]).toBeCloseTo(0, 5)
    }
  })

  it('places a pure cosine in exactly one bin pair', () => {
    const n = 64
    const bin = 5
    const fft = new FFT(n)
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n)
    fft.forward(re, im)
    // Energy concentrated at bin and its mirror (n-bin), magnitude n/2.
    const mag = (k: number) => Math.hypot(re[k], im[k])
    expect(mag(bin)).toBeCloseTo(n / 2, 3)
    expect(mag(n - bin)).toBeCloseTo(n / 2, 3)
    for (let k = 0; k < n; k++) {
      if (k === bin || k === n - bin) continue
      expect(mag(k)).toBeLessThan(1e-3)
    }
  })

  it('inverse(forward(x)) reconstructs the input', () => {
    const n = 256
    const fft = new FFT(n)
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    const orig = new Float32Array(n)
    // Deterministic pseudo-random-ish signal.
    for (let i = 0; i < n; i++) {
      orig[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7) - 0.2 * Math.sin(i * 0.05)
      re[i] = orig[i]
    }
    fft.forward(re, im)
    fft.inverse(re, im)
    const err = new Float32Array(n)
    for (let i = 0; i < n; i++) err[i] = re[i] - orig[i]
    expect(maxAbs(err)).toBeLessThan(1e-4)
    expect(maxAbs(im)).toBeLessThan(1e-4)
  })

  it('produces finite output for silence', () => {
    const n = 128
    const fft = new FFT(n)
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    fft.forward(re, im)
    for (let k = 0; k < n; k++) {
      expect(Number.isFinite(re[k])).toBe(true)
      expect(Number.isFinite(im[k])).toBe(true)
    }
  })
})
