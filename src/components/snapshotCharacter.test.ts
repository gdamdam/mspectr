import { describe, it, expect } from 'vitest'
import { snapshotCharacter } from './snapshotCharacter'

/** Build a single-frame magnitude buffer with energy at the given bins. */
function frame(binCount: number, energy: (i: number) => number): Float32Array {
  const m = new Float32Array(binCount)
  for (let i = 0; i < binCount; i++) m[i] = energy(i)
  return m
}

describe('snapshotCharacter', () => {
  it('reports "quiet" for an empty buffer', () => {
    expect(snapshotCharacter(new Float32Array(0), 0)).toBe('quiet')
  })

  it('reports "quiet" for an all-zero frame', () => {
    expect(snapshotCharacter(frame(64, () => 0), 64)).toBe('quiet')
  })

  it('reports "quiet" when binCount is non-positive', () => {
    expect(snapshotCharacter(frame(64, () => 1), 0)).toBe('quiet')
  })

  it('is finite-safe against NaN/Infinity bins', () => {
    const m = frame(64, (i) => (i < 4 ? 1 : 0))
    m[10] = NaN
    m[11] = Infinity
    expect(snapshotCharacter(m, 64)).not.toBe('quiet')
    // Energy sits in the low bins → dark brightness.
    expect(snapshotCharacter(m, 64).startsWith('dark')).toBe(true)
  })

  it('distinguishes bright (high-bin energy) from dark (low-bin energy)', () => {
    const dark = frame(64, (i) => (i < 3 ? 1 : 0))
    const bright = frame(64, (i) => (i > 58 ? 1 : 0))
    const darkWord = snapshotCharacter(dark, 64).split(' · ')[0]
    const brightWord = snapshotCharacter(bright, 64).split(' · ')[0]
    expect(darkWord).toBe('dark')
    expect(['bright', 'airy']).toContain(brightWord)
    expect(darkWord).not.toBe(brightWord)
  })

  it('distinguishes tonal (single peak) from noisy (flat spectrum)', () => {
    const tonal = frame(64, (i) => (i === 20 ? 1 : 0))
    const noisy = frame(64, () => 1)
    const tonalWord = snapshotCharacter(tonal, 64).split(' · ')[1]
    const noisyWord = snapshotCharacter(noisy, 64).split(' · ')[1]
    expect(tonalWord).toBe('tonal')
    expect(noisyWord).toBe('noisy')
  })

  it('reads only the first frame of a multi-frame frame-major buffer', () => {
    const binCount = 32
    // Frame 0: dark (low bins). Frame 1: bright (high bins). Should describe frame 0.
    const multi = new Float32Array(binCount * 2)
    for (let i = 0; i < 3; i++) multi[i] = 1 // frame 0, low bins
    for (let i = binCount + 28; i < binCount * 2; i++) multi[i] = 1 // frame 1, high bins
    expect(snapshotCharacter(multi, binCount).startsWith('dark')).toBe(true)
  })

  it('is deterministic for identical input', () => {
    const m = frame(48, (i) => Math.sin(i) * Math.sin(i))
    expect(snapshotCharacter(m, 48)).toBe(snapshotCharacter(m, 48))
  })
})
