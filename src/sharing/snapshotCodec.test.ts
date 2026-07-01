import { describe, expect, it } from 'vitest'
import {
  MAX_FFT_SIZE,
  MAX_SNAPSHOT_FRAMES,
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

function makeSnapshot(fftSize: number, withPhase: boolean, frameCount = 1): SpectralSnapshot {
  const binCount = fftSize / 2 + 1
  const total = frameCount * binCount
  const magnitude = new Float32Array(total)
  const phase = withPhase ? new Float32Array(total) : null
  for (let f = 0; f < frameCount; f++) {
    for (let i = 0; i < binCount; i++) {
      const idx = f * binCount + i
      // A per-frame evolving spectrum, each frame distinct, all within [-100, 0] dB.
      magnitude[idx] = dbToGain(-60 + 40 * Math.cos((i + f * 3) / 5))
      if (phase) phase[idx] = -Math.PI + (2 * Math.PI * ((i + f) % binCount)) / binCount
    }
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 220,
    frameCount,
    frameHop: fftSize / 4,
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

  it('round-trips a multi-frame snapshot frame-major within ~0.5 dB', () => {
    const frameCount = 8
    const snap = makeSnapshot(2048, true, frameCount)
    const ser = serializeSnapshot(snap)
    expect(ser.frames).toBe(frameCount)
    expect(ser.frameHop).toBe(2048 / 4)
    const back = deserializeSnapshot(ser)
    expect(back.frameCount).toBe(frameCount)
    expect(back.frameHop).toBe(2048 / 4)
    expect(back.magnitude.length).toBe(frameCount * snap.binCount)
    expect((back.phase as Float32Array).length).toBe(frameCount * snap.binCount)
    // Every frame's every bin survives the frame-major flatten within tolerance.
    for (let i = 0; i < snap.magnitude.length; i++) {
      const origDb = gainToDb(snap.magnitude[i], DEFAULT_MAG_FLOOR_DB)
      const backDb = gainToDb(back.magnitude[i], DEFAULT_MAG_FLOOR_DB)
      expect(Math.abs(origDb - backDb)).toBeLessThanOrEqual(0.5)
    }
  })

  it('preserves distinct per-frame content (frames are not collapsed)', () => {
    const snap = makeSnapshot(1024, false, 4)
    const back = deserializeSnapshot(serializeSnapshot(snap))
    // Frame 0 and frame 3 differ in the source; they must still differ after
    // the round trip, proving frames are laid out independently.
    const bin = 10
    const f0 = back.magnitude[0 * back.binCount + bin]
    const f3 = back.magnitude[3 * back.binCount + bin]
    expect(f0).not.toBe(f3)
  })

  it('migrates a v1 snapshot (no frames field) to frameCount 1', () => {
    const snap = makeSnapshot(1024, false)
    const ser = serializeSnapshot(snap)
    // Strip the v2-only fields and stamp version 1, as an old persisted row.
    const { frames: _frames, frameHop: _frameHop, ...rest } = ser
    const v1 = { ...rest, v: 1 } as unknown as SerializedSnapshot
    expect((v1 as { frames?: number }).frames).toBeUndefined()
    const back = deserializeSnapshot(v1)
    expect(back.frameCount).toBe(1)
    // Migrated hop is the standard STFT hop for the fft size.
    expect(back.frameHop).toBe(1024 / 4)
    expect(back.magnitude.length).toBe(snap.binCount)
    expect(back.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
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

  it('rejects truncated magnitude bytes (frames*binCount mismatch)', () => {
    const s = base()
    // Truncate the base64 so it decodes to fewer than frames*binCount bytes.
    const shortBytes = base64UrlToBytes(s.mag).subarray(0, 10)
    expect(() => deserializeSnapshot({ ...s, mag: bytesToBase64Url(shortBytes) })).toThrow(
      /length/,
    )
  })

  it('rejects frames beyond MAX_SNAPSHOT_FRAMES without allocating', () => {
    // A huge frame count must be refused on the bound check, never by trying to
    // allocate a Float32Array of frames*binCount.
    expect(() => deserializeSnapshot({ ...base(), frames: MAX_SNAPSHOT_FRAMES + 1 })).toThrow(
      /out of/,
    )
  })

  it('rejects a zero / non-integer frame count', () => {
    expect(() => deserializeSnapshot({ ...base(), frames: 0 })).toThrow(/out of/)
    expect(() => deserializeSnapshot({ ...base(), frames: 2.5 })).toThrow(/out of/)
  })

  it('rejects a frame count that disagrees with the magnitude byte length', () => {
    // Claim 4 frames but ship the single-frame byte payload from base().
    const s = base()
    expect(() => deserializeSnapshot({ ...s, frames: 4 })).toThrow(/length/)
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
