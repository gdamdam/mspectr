import { describe, it, expect } from 'vitest'
import {
  TWO_PI,
  wrapPhase,
  baseBinOmega,
  makePhaseDrift,
  findSpectralPeaks,
  lockPhasesToPeaks,
} from './phase'

describe('existing phase helpers', () => {
  it('wrapPhase maps into (-π, π]', () => {
    expect(wrapPhase(0)).toBe(0)
    expect(wrapPhase(TWO_PI)).toBeCloseTo(0, 12)
    expect(wrapPhase(Math.PI)).toBeCloseTo(Math.PI, 12)
    expect(wrapPhase(-Math.PI)).toBeCloseTo(Math.PI, 12) // -π wraps up to +π
    expect(wrapPhase(3 * Math.PI)).toBeCloseTo(Math.PI, 12)
  })

  it('baseBinOmega gives 2π·k·hop/N', () => {
    const omega = baseBinOmega(4, 8, 2)
    const step = (TWO_PI * 2) / 8
    expect(omega[0]).toBe(0)
    // Float32Array storage → single-precision tolerance.
    expect(omega[1]).toBeCloseTo(step, 5)
    expect(omega[3]).toBeCloseTo(step * 3, 5)
  })

  it('makePhaseDrift is deterministic and bounded', () => {
    const a = makePhaseDrift(1234)
    const b = makePhaseDrift(1234)
    for (let i = 0; i < 8; i++) {
      const va = a(0.1)
      expect(va).toBe(b(0.1))
      expect(Math.abs(va)).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('findSpectralPeaks', () => {
  it('finds peaks at expected bins in a synthetic spectrum', () => {
    const N = 64
    const mag = new Float32Array(N)
    // Broad-ish lobes so each peak is a strict local max over ±2 neighbours.
    const put = (center: number, amp: number) => {
      mag[center - 2] += amp * 0.25
      mag[center - 1] += amp * 0.6
      mag[center] += amp
      mag[center + 1] += amp * 0.6
      mag[center + 2] += amp * 0.25
    }
    put(10, 1)
    put(20, 0.8)
    put(40, 1.2)

    const peaks = new Int32Array(N)
    const n = findSpectralPeaks(mag, peaks)
    const found = Array.from(peaks.subarray(0, n)).sort((x, y) => x - y)
    expect(found).toEqual([10, 20, 40])
  })

  it('ignores tiny noise below the relative floor', () => {
    const N = 64
    const mag = new Float32Array(N)
    // One strong peak.
    mag[30] = 5
    mag[29] = 3
    mag[28] = 1
    mag[31] = 3
    mag[32] = 1
    // Tiny wiggles that form local maxima but are far below the floor.
    mag[5] = 1e-6
    mag[4] = 1e-7
    mag[6] = 1e-7

    const peaks = new Int32Array(N)
    const n = findSpectralPeaks(mag, peaks)
    expect(n).toBe(1)
    expect(peaks[0]).toBe(30)
  })

  it('returns no peaks for all-zero magnitude without throwing', () => {
    const N = 32
    const mag = new Float32Array(N)
    const peaks = new Int32Array(N)
    expect(() => findSpectralPeaks(mag, peaks)).not.toThrow()
    expect(findSpectralPeaks(mag, peaks)).toBe(0)
  })

  it('does not report peaks at the array edges (needs 2 neighbours each side)', () => {
    const N = 16
    const mag = new Float32Array(N)
    mag[0] = 10 // edge, no left neighbours
    mag[N - 1] = 10 // edge, no right neighbours
    const peaks = new Int32Array(N)
    expect(findSpectralPeaks(mag, peaks)).toBe(0)
  })
})

describe('lockPhasesToPeaks', () => {
  it('locks every bin in a region of influence to its peak phase', () => {
    const N = 64
    const mag = new Float32Array(N)
    const put = (center: number, amp: number) => {
      mag[center - 2] += amp * 0.25
      mag[center - 1] += amp * 0.6
      mag[center] += amp
      mag[center + 1] += amp * 0.6
      mag[center + 2] += amp * 0.25
    }
    put(10, 1)
    put(40, 1)

    const phase = new Float32Array(N)
    for (let k = 0; k < N; k++) phase[k] = Math.sin(k) // arbitrary distinct phases

    const peaks = new Int32Array(N)
    const n = findSpectralPeaks(mag, peaks)
    expect(n).toBe(2)

    const peak10Phase = phase[10]
    const peak40Phase = phase[40]
    lockPhasesToPeaks(phase, mag, peaks, n)

    // Midpoint between 10 and 40 is 25 → bins <= 25 lock to peak 10, > 25 to peak 40.
    for (let k = 0; k <= 25; k++) expect(phase[k]).toBe(peak10Phase)
    for (let k = 26; k < N; k++) expect(phase[k]).toBe(peak40Phase)
    // All finite.
    for (let k = 0; k < N; k++) expect(Number.isFinite(phase[k])).toBe(true)
  })

  it('single peak → all bins lock to it', () => {
    const N = 32
    const mag = new Float32Array(N)
    mag[16] = 5
    mag[15] = 3
    mag[14] = 1
    mag[17] = 3
    mag[18] = 1

    const phase = new Float32Array(N)
    for (let k = 0; k < N; k++) phase[k] = k * 0.01

    const peaks = new Int32Array(N)
    const n = findSpectralPeaks(mag, peaks)
    expect(n).toBe(1)

    const target = phase[16]
    lockPhasesToPeaks(phase, mag, peaks, n)
    for (let k = 0; k < N; k++) expect(phase[k]).toBe(target)
  })

  it('is a no-op when there are no peaks', () => {
    const N = 16
    const mag = new Float32Array(N)
    const phase = new Float32Array(N)
    for (let k = 0; k < N; k++) phase[k] = k
    const before = Float32Array.from(phase)

    const peaks = new Int32Array(N)
    lockPhasesToPeaks(phase, mag, peaks, 0)
    expect(Array.from(phase)).toEqual(Array.from(before))
  })

  it('keeps phases finite', () => {
    const N = 48
    const mag = new Float32Array(N)
    mag[24] = 2
    mag[23] = 1
    mag[22] = 0.5
    mag[25] = 1
    mag[26] = 0.5
    const phase = new Float32Array(N)
    for (let k = 0; k < N; k++) phase[k] = Math.cos(k * 3.1)

    const peaks = new Int32Array(N)
    const n = findSpectralPeaks(mag, peaks)
    lockPhasesToPeaks(phase, mag, peaks, n)
    for (let k = 0; k < N; k++) expect(Number.isFinite(phase[k])).toBe(true)
  })
})
