import { describe, expect, it } from 'vitest'
import { dbToGain } from '../contracts'
import { applyBlur, blurRadius } from './blur'
import { FrameAverager, captureFrame } from './freeze'
import { applyFormant, spectralEnvelope } from './formant'
import { SpectralGate } from './gate'
import { applyHarmonize } from './harmonize'
import { StereoLimiter } from './limiter'
import { morphMagnitude, spectralEnergy } from './morph'
import { applyFreqShift, resampleSpectrum } from './shift'
import { applyTilt } from './tilt'

const energy = (a: Float32Array) => spectralEnergy(a)
const allFinite = (a: Float32Array) => a.every((v) => Number.isFinite(v))

describe('MORPH', () => {
  it('reproduces endpoints exactly at t=0 and t=1', () => {
    const a = Float32Array.from([1, 2, 3, 0, 0])
    const b = Float32Array.from([0, 0, 1, 4, 2])
    const out = new Float32Array(5)
    morphMagnitude(a, b, 0, out)
    expect(Array.from(out)).toEqual(Array.from(a))
    morphMagnitude(a, b, 1, out)
    for (let k = 0; k < 5; k++) expect(out[k]).toBeCloseTo(b[k], 5)
  })

  it('preserves loudness across disjoint spectra at the midpoint', () => {
    const a = Float32Array.from([1, 0, 0, 0])
    const b = Float32Array.from([0, 0, 0, 1])
    const out = new Float32Array(4)
    morphMagnitude(a, b, 0.5, out)
    // Naive blend would give energy 0.5; loudness-preserving keeps it ≈1.
    expect(energy(out)).toBeCloseTo(1, 4)
  })
})

describe('TILT', () => {
  it('brightens with positive tilt and preserves energy', () => {
    const mag = new Float32Array(64).fill(1)
    const out = new Float32Array(64)
    applyTilt(mag, 1, out, 48000, 128)
    expect(out[60]).toBeGreaterThan(out[2])
    expect(energy(out)).toBeCloseTo(energy(mag), 2)
    expect(allFinite(out)).toBe(true)
  })
})

describe('BLUR', () => {
  it('spreads a spike, lowers its peak, preserves energy, and is bounded', () => {
    const n = 240
    const mag = new Float32Array(n)
    mag[120] = 10
    const out = new Float32Array(n)
    applyBlur(mag, 1, out)
    expect(out[120]).toBeLessThan(10)
    expect(out[121]).toBeGreaterThan(0)
    expect(energy(out)).toBeCloseTo(energy(mag), 1)
    // Bounded radius: never wider than n/24.
    expect(blurRadius(n, 1)).toBeLessThanOrEqual(Math.floor(n / 24))
    expect(blurRadius(n, 0)).toBe(0)
  })
})

describe('SPECTRAL GATE', () => {
  it('eases toward the target (no instant zeroing) and converges', () => {
    const mag = Float32Array.from([1, 0.05, 0.8, 0.02])
    const gate = new SpectralGate(4, 0.35)
    const out = new Float32Array(4)
    gate.process(mag, 0.5, out)
    // First frame: low bins attenuated but not yet zero (smoothing).
    expect(out[1]).toBeGreaterThan(0)
    expect(out[1]).toBeLessThan(mag[1])
    for (let i = 0; i < 200; i++) gate.process(mag, 0.5, out)
    // Converged: below-threshold bins ≈0, above-threshold bins ≈ original.
    expect(out[1]).toBeLessThan(1e-3)
    expect(out[3]).toBeLessThan(1e-3)
    expect(out[0]).toBeCloseTo(1, 2)
    expect(out[2]).toBeCloseTo(0.8, 2)
  })

  it('passes through when threshold is 0', () => {
    const mag = Float32Array.from([0.3, 0.1, 0.9])
    const gate = new SpectralGate(3)
    const out = new Float32Array(3)
    for (let i = 0; i < 10; i++) gate.process(mag, 0, out)
    for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(mag[k], 3)
  })
})

describe('SHIFT vs RESAMPLE (distinct behaviours)', () => {
  it('additive shift moves a partial by a constant bin offset', () => {
    const mag = new Float32Array(64)
    mag[10] = 1
    const out = new Float32Array(64)
    applyFreqShift(mag, 3, out)
    expect(out[13]).toBeCloseTo(1, 5)
    expect(out[10]).toBeCloseTo(0, 5)
  })

  it('multiplicative resample moves a partial by a frequency ratio', () => {
    const mag = new Float32Array(64)
    mag[10] = 1
    const out = new Float32Array(64)
    resampleSpectrum(mag, 2, out) // up an octave
    expect(out[20]).toBeCloseTo(1, 5)
    expect(out[10]).toBeCloseTo(0, 5)
  })
})

describe('FORMANT', () => {
  it('is identity at 0 semitones', () => {
    const mag = Float32Array.from([1, 2, 1, 0.5, 0.2, 3, 1])
    const out = new Float32Array(7)
    applyFormant(mag, 0, out, new Float32Array(7), new Float32Array(7))
    for (let k = 0; k < 7; k++) expect(out[k]).toBeCloseTo(mag[k], 5)
  })

  it('keeps a partial at its bin (pitch preserved) while shifting the envelope', () => {
    const n = 256
    const mag = new Float32Array(n)
    // Smooth envelope bed + a sharp partial at bin 40.
    for (let k = 0; k < n; k++) mag[k] = 0.2 * Math.exp(-((k - 80) ** 2) / (2 * 30 * 30))
    mag[40] += 1
    const out = new Float32Array(n)
    applyFormant(mag, 7, out, new Float32Array(n), new Float32Array(n))
    // The partial stays a local maximum at bin 40.
    expect(out[40]).toBeGreaterThan(out[39])
    expect(out[40]).toBeGreaterThan(out[41])
    expect(allFinite(out)).toBe(true)
  })
})

describe('formant-preserving transposition (keytrack)', () => {
  // Mirrors the SpectralEngine per-voice chain: resampleSpectrum for pitch, then
  // applyFormant with a keytrack-compensating envelope shift. With keytrack ON the
  // engine sets voiceFormant = -pitchSemis, undoing the resample's envelope drift.
  const n = 256
  const center = 100 // formant (envelope) peak bin
  const bump = (k: number) => 0.05 + Math.exp(-((k - center) ** 2) / (2 * 25 * 25))
  function harmonicTone(): Float32Array {
    const mag = new Float32Array(n)
    for (let k = 0; k < n; k++) mag[k] = bump(k)
    // Sharp partials every 10 bins, weighted by the envelope.
    for (let h = 10; h < n; h += 10) mag[h] += 2 * bump(h)
    return mag
  }
  const argmax = (a: Float32Array) => {
    let bi = 0
    for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i
    return bi
  }

  it('+12 with keytrack ON keeps the envelope peak fixed while partials move up', () => {
    const mag = harmonicTone()
    // Original: partial at bin 10, gap at 20 is spanned — envelope peak near center.
    expect(mag[10]).toBeGreaterThan(mag[15])

    // Pitch up an octave (ratio 2): resampleSpectrum moves partials AND envelope up.
    const resampled = new Float32Array(n)
    resampleSpectrum(mag, 2, resampled)
    const env = new Float32Array(n)

    // Keytrack OFF baseline (voiceFormant 0): envelope peak drifts up ~2x (chipmunk).
    spectralEnvelope(resampled, env)
    const peakNoTrack = argmax(env)
    expect(peakNoTrack).toBeGreaterThan(center + 50)

    // Keytrack ON: voiceFormant = -12 re-imposes the original envelope.
    const kept = new Float32Array(n)
    applyFormant(resampled, -12, kept, new Float32Array(n), new Float32Array(n))
    spectralEnvelope(kept, env)
    const peakKept = argmax(env)
    // Envelope peak stays near the original center, far below the chipmunk peak.
    expect(Math.abs(peakKept - center)).toBeLessThan(40)
    expect(peakKept).toBeLessThan(peakNoTrack - 40)

    // Partials still moved: original partial at bin 10, now energy at bin 20 not 10.
    expect(kept[20]).toBeGreaterThan(kept[10] * 3)
    expect(allFinite(kept)).toBe(true)
  })

  it('keytrack OFF is byte-identical to plain resampling (backward-compat default)', () => {
    const mag = harmonicTone()
    const ratio = Math.pow(2, 7 / 12)
    const resampled = new Float32Array(n)
    resampleSpectrum(mag, ratio, resampled)
    // Default keytrackFormant 0 (and formant 0) ⇒ engine calls applyFormant with 0
    // semitones ⇒ identity ⇒ output equals plain resampling, bit for bit.
    const out = new Float32Array(n)
    applyFormant(resampled, 0, out, new Float32Array(n), new Float32Array(n))
    expect(Array.from(out)).toEqual(Array.from(resampled))
  })
})

describe('HARMONIZE', () => {
  it('adds an octave voice with gain compensation', () => {
    const n = 64
    const mag = new Float32Array(n)
    mag[10] = 1
    const out = new Float32Array(n)
    applyHarmonize(mag, 1, [12], 1, out, new Float32Array(n))
    expect(out[10]).toBeCloseTo(1, 5) // dry preserved
    const comp = 1 / Math.sqrt(2)
    expect(out[20]).toBeCloseTo(comp, 4) // octave-up voice, compensated
  })

  it('is identity with zero voices', () => {
    const mag = Float32Array.from([1, 2, 3])
    const out = new Float32Array(3)
    applyHarmonize(mag, 0, [12], 1, out, new Float32Array(3))
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})

describe('LIMITER', () => {
  it('never exceeds the ceiling and reports gain reduction', () => {
    const limiter = new StereoLimiter(48000, -1)
    const ceiling = dbToGain(-1)
    const n = 2048
    const left = new Float32Array(n)
    const right = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      left[i] = 2 * Math.sin((2 * Math.PI * 220 * i) / 48000)
      right[i] = NaN // hostile input on one channel
    }
    limiter.process(left, right)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(left[i])).toBeLessThanOrEqual(ceiling + 1e-6)
      expect(Number.isFinite(right[i])).toBe(true)
    }
    expect(limiter.gainReductionDb).toBeGreaterThan(0)
  })
})

describe('FREEZE capture', () => {
  it('captureFrame copies deterministically', () => {
    const mag = Float32Array.from([1, 2, 3])
    const phase = Float32Array.from([0.1, 0.2, 0.3])
    const dm = new Float32Array(3)
    const dp = new Float32Array(3)
    captureFrame(mag, phase, dm, dp)
    expect(Array.from(dm)).toEqual([1, 2, 3])
    expect(Array.from(dp)).toEqual(Array.from(phase))
  })

  it('FrameAverager averages magnitude over a region', () => {
    const avg = new FrameAverager(2)
    avg.add(Float32Array.from([2, 4]), Float32Array.from([0, 0]))
    avg.add(Float32Array.from([4, 8]), Float32Array.from([1, 1]))
    const dm = new Float32Array(2)
    const dp = new Float32Array(2)
    expect(avg.finish(dm, dp)).toBe(true)
    expect(Array.from(dm)).toEqual([3, 6])
    expect(avg.frames).toBe(2)
  })
})
