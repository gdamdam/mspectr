import { describe, expect, it } from 'vitest'
import {
  sanitizeSnapshot,
  sanitizePersistedSource,
  isSourceRestorable,
  MAX_SNAPSHOT_FRAMES,
  MIN_FFT_SIZE,
  MAX_FFT_SIZE,
  SNAPSHOT_SCHEMA_VERSION,
  type SpectralSnapshot,
} from './contracts'

function makeSnapshot(over: Partial<SpectralSnapshot> = {}): unknown {
  const fftSize = over.fftSize ?? 2048
  const binCount = (fftSize >> 1) + 1
  const frameCount = over.frameCount ?? 2
  const len = frameCount * binCount
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48_000,
    baseFrequency: 220,
    frameCount,
    frameHop: 512,
    magnitude: new Float32Array(len).fill(0.5),
    phase: new Float32Array(len).fill(0.1),
    sourceLabel: 'Mic',
    capturedAt: 1234,
    isLiveDerived: true,
    ...over,
  }
}

describe('sanitizeSnapshot', () => {
  it('passes a well-formed snapshot through with bounds intact', () => {
    const s = sanitizeSnapshot(makeSnapshot())!
    expect(s).not.toBeNull()
    expect(s.fftSize).toBe(2048)
    expect(s.binCount).toBe(1025)
    expect(s.frameCount).toBe(2)
    expect(s.magnitude.length).toBe(2 * 1025)
    expect(s.phase?.length).toBe(2 * 1025)
    expect(s).toMatchObject({ sourceLabel: 'Mic', capturedAt: 1234, isLiveDerived: true })
  })

  it('rejects non-objects and missing/empty magnitude', () => {
    expect(sanitizeSnapshot(null)).toBeNull()
    expect(sanitizeSnapshot(42)).toBeNull()
    expect(sanitizeSnapshot({})).toBeNull()
    expect(sanitizeSnapshot({ magnitude: [1, 2, 3] })).toBeNull() // not a Float32Array
    expect(sanitizeSnapshot(makeSnapshot({ magnitude: new Float32Array(0) }))).toBeNull()
  })

  it('clamps fftSize into the hard bounds and derives binCount', () => {
    // Declares fftSize below MIN but supplies a buffer sized for the clamped
    // binCount, so it is accepted at the clamped size rather than rejected.
    const lowBins = (MIN_FFT_SIZE >> 1) + 1
    const low = sanitizeSnapshot({
      ...(makeSnapshot({ frameCount: 1 }) as object),
      fftSize: 16,
      magnitude: new Float32Array(lowBins).fill(0.2),
      phase: null,
    })!
    expect(low.fftSize).toBe(MIN_FFT_SIZE)
    expect(low.binCount).toBe(lowBins)
    // A declared sub-MIN fftSize with a correspondingly tiny buffer is rejected.
    expect(sanitizeSnapshot(makeSnapshot({ fftSize: 16, frameCount: 1 }))).toBeNull()
    // Oversized fftSize with a matching (large) buffer clamps to MAX_FFT_SIZE.
    const bc = (MAX_FFT_SIZE >> 1) + 1
    const high = sanitizeSnapshot({
      ...(makeSnapshot({ fftSize: 999_999, frameCount: 1 }) as object),
      fftSize: 999_999,
      magnitude: new Float32Array(bc).fill(0.2),
    })!
    expect(high.fftSize).toBe(MAX_FFT_SIZE)
    expect(high.binCount).toBe(bc)
  })

  it('caps frameCount to what the magnitude array actually holds', () => {
    // Declares 5 frames but supplies only one frame worth of data.
    const binCount = (2048 >> 1) + 1
    const s = sanitizeSnapshot({
      ...(makeSnapshot() as object),
      frameCount: 5,
      magnitude: new Float32Array(binCount).fill(0.3),
      phase: null,
    })!
    expect(s.frameCount).toBe(1)
    expect(s.magnitude.length).toBe(binCount)
    expect(s.phase).toBeNull()
  })

  it('caps frameCount at MAX_SNAPSHOT_FRAMES even with a huge buffer', () => {
    const binCount = (2048 >> 1) + 1
    const s = sanitizeSnapshot({
      ...(makeSnapshot() as object),
      frameCount: 9999,
      magnitude: new Float32Array(binCount * (MAX_SNAPSHOT_FRAMES + 10)).fill(0.1),
      phase: null,
    })!
    expect(s.frameCount).toBe(MAX_SNAPSHOT_FRAMES)
  })

  it('coerces non-finite samples to 0 and drops mismatched phase', () => {
    const binCount = (2048 >> 1) + 1
    const mag = new Float32Array(binCount).fill(0.5)
    mag[0] = NaN
    mag[1] = Infinity
    const s = sanitizeSnapshot({
      ...(makeSnapshot({ frameCount: 1 }) as object),
      magnitude: mag,
      phase: new Float32Array(4), // too short → dropped
    })!
    expect(s.magnitude[0]).toBe(0)
    expect(s.magnitude[1]).toBe(0)
    expect(s.magnitude[2]).toBe(0.5)
    expect(s.phase).toBeNull()
  })

  it('truncates an over-long sourceLabel', () => {
    const s = sanitizeSnapshot(makeSnapshot({ sourceLabel: 'x'.repeat(500) }))!
    expect(s.sourceLabel.length).toBe(200)
  })
})

describe('sanitizePersistedSource', () => {
  it('keeps a valid generated source with its id', () => {
    const s = sanitizePersistedSource({ kind: 'generated', label: 'Glass', generatedId: 'glass-harmonica' })!
    expect(s).toEqual({ kind: 'generated', label: 'Glass', generatedId: 'glass-harmonica' })
    expect(isSourceRestorable(s)).toBe(true)
  })

  it('drops an unknown generated id to null (not restorable)', () => {
    const s = sanitizePersistedSource({ kind: 'generated', label: 'X', generatedId: 'not-a-source' })!
    expect(s.generatedId).toBeNull()
    expect(isSourceRestorable(s)).toBe(false)
  })

  it('forces a null id and non-restorable for mic/tab/file', () => {
    for (const kind of ['microphone', 'tab', 'file'] as const) {
      const s = sanitizePersistedSource({ kind, label: 'Studio', generatedId: 'glass-harmonica' })!
      expect(s.kind).toBe(kind)
      expect(s.generatedId).toBeNull()
      expect(isSourceRestorable(s)).toBe(false)
    }
  })

  it('rejects non-objects and invalid kinds, and truncates the label', () => {
    expect(sanitizePersistedSource(null)).toBeNull()
    expect(sanitizePersistedSource({ kind: 'bogus' })).toBeNull()
    expect(sanitizePersistedSource({})).toBeNull()
    const s = sanitizePersistedSource({ kind: 'file', label: 'y'.repeat(300) })!
    expect(s.label.length).toBe(120)
  })

  it('isSourceRestorable is false for null/undefined', () => {
    expect(isSourceRestorable(null)).toBe(false)
    expect(isSourceRestorable(undefined)).toBe(false)
  })
})
