import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATCH,
  MAX_SNAPSHOT_FRAMES,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  type SpectralPatch,
  type SpectralSnapshot,
} from '../audio/contracts'
import {
  MAX_SNAPSHOT_LINK_BYTES,
  decodePatchLink,
  decodeSnapshotLink,
  encodePatchLink,
  encodeSnapshotLink,
  estimateSnapshotLinkBytes,
} from './patchLink'
import { bytesToBase64Url, serializeSnapshot } from './snapshotCodec'

function makeSnapshot(fftSize: number, live: boolean, frameCount = 1): SpectralSnapshot {
  const binCount = fftSize / 2 + 1
  const total = frameCount * binCount
  const magnitude = new Float32Array(total)
  for (let f = 0; f < frameCount; f++) {
    for (let i = 0; i < binCount; i++) {
      magnitude[f * binCount + i] = dbToGain(-50 + 30 * Math.sin((i + f * 2) / 7))
    }
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 44100,
    baseFrequency: 110,
    frameCount,
    frameHop: fftSize / 4,
    magnitude,
    phase: null,
    sourceLabel: live ? 'mic' : 'preset',
    capturedAt: 7,
    isLiveDerived: live,
  }
}

describe('patch links', () => {
  it('round-trips a patch deterministically', () => {
    const patch: SpectralPatch = {
      ...DEFAULT_PATCH,
      seed: 42,
      params: { ...DEFAULT_PATCH.params, shift: 7, blur: 0.5 },
    }
    const link = encodePatchLink(patch)
    // Deterministic: same input → same string (no Date.now / Math.random).
    expect(encodePatchLink(patch)).toBe(link)
    const back = decodePatchLink(link)
    expect(back).not.toBeNull()
    expect(back?.seed).toBe(42)
    expect(back?.params.shift).toBe(7)
    expect(back?.params.blur).toBe(0.5)
  })

  it('sanitizes out-of-range values through the link', () => {
    const hostile = {
      ...DEFAULT_PATCH,
      polyphony: 9999,
      params: { ...DEFAULT_PATCH.params, blur: 50 },
    } as unknown as SpectralPatch
    const back = decodePatchLink(encodePatchLink(hostile))
    expect(back).not.toBeNull()
    expect(back?.polyphony).toBeLessThanOrEqual(8)
    expect(back?.params.blur).toBeLessThanOrEqual(1)
  })

  it('returns null on malformed fragments', () => {
    expect(decodePatchLink('')).toBeNull()
    expect(decodePatchLink('!!!not base64!!!')).toBeNull()
    expect(decodePatchLink(bytesToBase64Url(new TextEncoder().encode('not json')))).toBeNull()
  })
})

describe('snapshot links', () => {
  it('round-trips patch + A/B snapshots and preserves isLiveDerived', () => {
    const patch: SpectralPatch = { ...DEFAULT_PATCH, seed: 5 }
    const a = makeSnapshot(1024, true)
    const b = makeSnapshot(512, false)
    const link = encodeSnapshotLink(patch, a, b)
    const back = decodeSnapshotLink(link)
    expect(back).not.toBeNull()
    expect(back?.patch.seed).toBe(5)
    expect(back?.a?.fftSize).toBe(1024)
    expect(back?.b?.fftSize).toBe(512)
    // Consent gating depends on this surviving.
    expect(back?.a?.isLiveDerived).toBe(true)
    expect(back?.b?.isLiveDerived).toBe(false)
  })

  it('preserves A/B endpoint identity (slots are not swapped)', () => {
    const a = makeSnapshot(1024, true)
    const b = makeSnapshot(2048, false)
    const back = decodeSnapshotLink(encodeSnapshotLink(DEFAULT_PATCH, a, b))
    expect(back?.a?.fftSize).toBe(1024)
    expect(back?.b?.fftSize).toBe(2048)
  })

  it('round-trips with null snapshots', () => {
    const back = decodeSnapshotLink(encodeSnapshotLink(DEFAULT_PATCH, null, null))
    expect(back).not.toBeNull()
    expect(back?.a).toBeNull()
    expect(back?.b).toBeNull()
  })

  it('estimateSnapshotLinkBytes returns the exact encoded length', () => {
    const a = makeSnapshot(1024, false)
    const link = encodeSnapshotLink(DEFAULT_PATCH, a, null)
    expect(estimateSnapshotLinkBytes(DEFAULT_PATCH, a, null)).toBe(link.length)
  })

  it('round-trips a multi-frame snapshot through a link', () => {
    const a = makeSnapshot(1024, true, 8)
    const back = decodeSnapshotLink(encodeSnapshotLink(DEFAULT_PATCH, a, null))
    expect(back).not.toBeNull()
    expect(back?.a?.frameCount).toBe(8)
    expect(back?.a?.frameHop).toBe(1024 / 4)
    expect(back?.a?.magnitude.length).toBe(8 * a.binCount)
    expect(back?.a?.isLiveDerived).toBe(true)
  })

  it('estimate grows with frame count (multi-frame byte budget is real)', () => {
    // A multi-frame snapshot carries frameCount times the magnitude bytes, so
    // the estimate must reflect the true, larger size — the UI gates on this.
    const one = estimateSnapshotLinkBytes(DEFAULT_PATCH, makeSnapshot(2048, false, 1), null)
    const many = estimateSnapshotLinkBytes(DEFAULT_PATCH, makeSnapshot(2048, false, 16), null)
    expect(many).toBeGreaterThan(one)
  })

  it('rejects a link that exceeds MAX_SNAPSHOT_LINK_BYTES', () => {
    // A large multi-frame snapshot at the max fft size blows past the ceiling;
    // decode must refuse it (returns null) rather than accept an unpasteable URL.
    const big = makeSnapshot(8192, true, MAX_SNAPSHOT_FRAMES)
    const link = encodeSnapshotLink(DEFAULT_PATCH, big, null)
    expect(link.length).toBeGreaterThan(MAX_SNAPSHOT_LINK_BYTES)
    expect(decodeSnapshotLink(link)).toBeNull()
  })

  it('rejects an oversized fragment without decoding', () => {
    const oversized = 'A'.repeat(MAX_SNAPSHOT_LINK_BYTES + 1)
    expect(decodeSnapshotLink(oversized)).toBeNull()
  })

  it('returns null when an embedded snapshot is malformed', () => {
    // Hand-build a payload whose snapshot has a non-power-of-two fftSize.
    const a = serializeSnapshot(makeSnapshot(1024, false))
    const payload = { p: DEFAULT_PATCH, a: { ...a, fftSize: 1000 } }
    const fragment = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
    expect(decodeSnapshotLink(fragment)).toBeNull()
  })

  it('returns null on garbage fragments', () => {
    expect(decodeSnapshotLink('')).toBeNull()
    expect(decodeSnapshotLink('@@@@')).toBeNull()
  })
})
