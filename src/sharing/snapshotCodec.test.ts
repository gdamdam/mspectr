import { describe, expect, it } from 'vitest'
import {
  MAX_FFT_SIZE,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  gainToDb,
  type SerializedSnapshot,
  type SpectralSnapshot,
} from '../audio/contracts'
import {
  DEFAULT_MAG_FLOOR_DB,
  base64UrlToBytes,
  bytesToBase64Url,
  deserializeSnapshot,
  serializeSnapshot,
} from './snapshotCodec'

function makeSnapshot(fftSize: number, withPhase: boolean): SpectralSnapshot {
  const binCount = fftSize / 2 + 1
  const magnitude = new Float32Array(binCount)
  const phase = withPhase ? new Float32Array(binCount) : null
  for (let i = 0; i < binCount; i++) {
    // A decaying spectrum staying well within [-100, 0] dB.
    magnitude[i] = dbToGain(-60 + 40 * Math.cos(i / 5))
    if (phase) phase[i] = -Math.PI + (2 * Math.PI * i) / binCount
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 220,
    magnitude,
    phase,
    sourceLabel: 'test-source',
    capturedAt: 1234,
    isLiveDerived: true,
  }
}

describe('base64url helpers', () => {
  it('round-trips bytes with no padding and url-safe alphabet', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 62, 63])
    const encoded = bytesToBase64Url(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes))
  })

  it('rejects non-base64 characters', () => {
    expect(() => base64UrlToBytes('not base64!!')).toThrow()
  })

  it('refuses to decode beyond maxBytes (allocation guard)', () => {
    const big = bytesToBase64Url(new Uint8Array(10000))
    expect(() => base64UrlToBytes(big, 100)).toThrow(/exceed/)
  })
})

describe('serializeSnapshot / deserializeSnapshot', () => {
  it('round-trips magnitude within ~0.5 dB', () => {
    const snap = makeSnapshot(2048, false)
    const back = deserializeSnapshot(serializeSnapshot(snap))
    expect(back.binCount).toBe(snap.binCount)
    for (let i = 0; i < snap.binCount; i++) {
      const origDb = gainToDb(snap.magnitude[i], DEFAULT_MAG_FLOOR_DB)
      const backDb = gainToDb(back.magnitude[i], DEFAULT_MAG_FLOOR_DB)
      expect(Math.abs(origDb - backDb)).toBeLessThanOrEqual(0.5)
    }
  })

  it('round-trips phase over [-pi, pi] within one quantization step', () => {
    const snap = makeSnapshot(1024, true)
    const back = deserializeSnapshot(serializeSnapshot(snap))
    expect(back.phase).not.toBeNull()
    const step = (2 * Math.PI) / 255
    for (let i = 0; i < snap.binCount; i++) {
      expect(Math.abs((back.phase as Float32Array)[i] - (snap.phase as Float32Array)[i])).toBeLessThanOrEqual(
        step,
      )
    }
  })

  it('omits phase when the source had none', () => {
    const snap = makeSnapshot(512, false)
    const ser = serializeSnapshot(snap)
    expect(ser.phase).toBeUndefined()
    expect(deserializeSnapshot(ser).phase).toBeNull()
  })

  it('preserves isLiveDerived and metadata', () => {
    const snap = makeSnapshot(2048, false)
    const back = deserializeSnapshot(serializeSnapshot(snap))
    expect(back.isLiveDerived).toBe(true)
    expect(back.sourceLabel).toBe('test-source')
    expect(back.analysisSampleRate).toBe(48000)
    expect(back.baseFrequency).toBe(220)
    expect(back.capturedAt).toBe(1234)
  })

  it('maps a silent (floored) bin back to exactly 0', () => {
    const snap = makeSnapshot(512, false)
    snap.magnitude[3] = 0
    const back = deserializeSnapshot(serializeSnapshot(snap))
    expect(back.magnitude[3]).toBe(0)
  })
})

describe('deserializeSnapshot validation (security boundary)', () => {
  function base(): SerializedSnapshot {
    return serializeSnapshot(makeSnapshot(1024, false))
  }

  it('rejects an unsupported version', () => {
    expect(() => deserializeSnapshot({ ...base(), v: 999 })).toThrow(/version/)
  })

  it('rejects a non-power-of-two fftSize', () => {
    expect(() => deserializeSnapshot({ ...base(), fftSize: 1000 })).toThrow(/power of two/)
  })

  it('rejects fftSize beyond MAX_FFT_SIZE without allocating', () => {
    // A huge fftSize must be refused on the bound check, never by trying to
    // allocate a Float32Array of (fftSize/2+1) and throwing RangeError.
    const huge = MAX_FFT_SIZE * 4
    expect(() => deserializeSnapshot({ ...base(), fftSize: huge })).toThrow(/out of/)
  })

  it('rejects truncated magnitude bytes (binCount mismatch)', () => {
    const s = base()
    // Truncate the base64 so it decodes to fewer than binCount bytes.
    const shortBytes = base64UrlToBytes(s.mag).subarray(0, 10)
    expect(() => deserializeSnapshot({ ...s, mag: bytesToBase64Url(shortBytes) })).toThrow(
      /length/,
    )
  })

  it('rejects a phase byte length that disagrees with binCount', () => {
    const s = base()
    const wrong = bytesToBase64Url(new Uint8Array(5))
    expect(() => deserializeSnapshot({ ...s, phase: wrong })).toThrow(/length/)
  })

  it('rejects an invalid magFloorDb', () => {
    expect(() => deserializeSnapshot({ ...base(), magFloorDb: 5 })).toThrow(/magFloorDb/)
    expect(() => deserializeSnapshot({ ...base(), magFloorDb: NaN })).toThrow(/magFloorDb/)
  })

  it('rejects a non-finite sample rate', () => {
    expect(() => deserializeSnapshot({ ...base(), sr: 0 })).toThrow(/sample rate/)
  })
})
