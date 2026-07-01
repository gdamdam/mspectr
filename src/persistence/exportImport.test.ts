import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATCH,
  INSTRUMENT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  gainToDb,
  type SavedInstrument,
  type SpectralSnapshot,
} from '../audio/contracts'
import { DEFAULT_MAG_FLOOR_DB } from '../sharing/snapshotCodec'
import { exportInstrumentJson, importInstrumentJson } from './exportImport'

function makeInstrument(): SavedInstrument {
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    id: 'inst-1',
    name: 'My Pad',
    createdAt: 100,
    updatedAt: 200,
    patch: { ...DEFAULT_PATCH, seed: 99 },
    snapshotRefA: 'snap-a',
    snapshotRefB: null,
    sourceLabel: 'studio',
  }
}

function makeSnapshot(fftSize: number): SpectralSnapshot {
  const binCount = fftSize / 2 + 1
  const magnitude = new Float32Array(binCount)
  for (let i = 0; i < binCount; i++) magnitude[i] = dbToGain(-40 + 20 * Math.cos(i / 4))
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 130,
    frameCount: 1,
    frameHop: fftSize / 4,
    magnitude,
    phase: null,
    sourceLabel: 'studio',
    capturedAt: 50,
    isLiveDerived: false,
  }
}

describe('exportInstrumentJson / importInstrumentJson', () => {
  it('round-trips an instrument with snapshots', () => {
    const inst = makeInstrument()
    const a = makeSnapshot(1024)
    const json = exportInstrumentJson(inst, a, null)
    const back = importInstrumentJson(json)
    expect(back.instrument.id).toBe('inst-1')
    expect(back.instrument.name).toBe('My Pad')
    expect(back.instrument.patch.seed).toBe(99)
    expect(back.instrument.createdAt).toBe(100)
    expect(back.instrument.updatedAt).toBe(200)
    expect(back.snapA).not.toBeNull()
    expect(back.snapA?.fftSize).toBe(1024)
    expect(back.snapB).toBeNull()
  })

  it('is deterministic (no Date.now / Math.random)', () => {
    const inst = makeInstrument()
    const a = makeSnapshot(512)
    expect(exportInstrumentJson(inst, a, null)).toBe(exportInstrumentJson(inst, a, null))
  })

  it('round-trips snapshot magnitude within ~0.5 dB', () => {
    const inst = makeInstrument()
    const a = makeSnapshot(1024)
    const back = importInstrumentJson(exportInstrumentJson(inst, a, null))
    for (let i = 0; i < a.binCount; i++) {
      const orig = gainToDb(a.magnitude[i], DEFAULT_MAG_FLOOR_DB)
      const got = gainToDb((back.snapA as SpectralSnapshot).magnitude[i], DEFAULT_MAG_FLOOR_DB)
      expect(Math.abs(orig - got)).toBeLessThanOrEqual(0.5)
    }
  })

  it('sanitizes an out-of-range patch on import', () => {
    const inst = makeInstrument()
    // Inject an out-of-range value into the serialized JSON.
    const json = exportInstrumentJson(inst, null, null)
    const obj = JSON.parse(json)
    obj.instrument.patch.polyphony = 9999
    const back = importInstrumentJson(JSON.stringify(obj))
    expect(back.instrument.patch.polyphony).toBeLessThanOrEqual(8)
  })

  it('drops a malformed embedded snapshot to null instead of throwing', () => {
    const inst = makeInstrument()
    const json = exportInstrumentJson(inst, makeSnapshot(1024), null)
    const obj = JSON.parse(json)
    obj.snapA.fftSize = 1000 // not a power of two
    const back = importInstrumentJson(JSON.stringify(obj))
    expect(back.snapA).toBeNull()
    expect(back.instrument.id).toBe('inst-1')
  })

  it('throws on malformed JSON', () => {
    expect(() => importInstrumentJson('{not json')).toThrow(/malformed JSON/)
  })

  it('throws on a wrong/missing envelope kind', () => {
    expect(() => importInstrumentJson(JSON.stringify({ foo: 1 }))).toThrow(/kind/)
    expect(() =>
      importInstrumentJson(JSON.stringify({ kind: 'mspectr-instrument' })),
    ).toThrow(/instrument/)
  })

  it('throws on a non-string input', () => {
    expect(() => importInstrumentJson(123 as unknown as string)).toThrow()
  })
})
