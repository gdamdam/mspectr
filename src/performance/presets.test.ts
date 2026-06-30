import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset } from './presets'
import { resolveParams } from './macros'
import {
  sanitizePatch,
  GENERATED_SOURCE_IDS,
  SCALE_DEGREES,
  PRESET_SCHEMA_VERSION,
  MAX_HARMONY_VOICES,
} from '../audio/contracts'
import type { CaptureMode, ScaleId, GeneratedSourceId } from '../audio/contracts'

const EXPECTED_NAMES = [
  'Glass Memory',
  'Frozen Choir',
  'Iron Bloom',
  'Hollow Radio',
  'Harmonic Fog',
  'Breath Organ',
  'Spectral Bells',
  'Slow Machine',
  'Formant Tide',
  'Noise Cathedral',
]

const VALID_SCALES = Object.keys(SCALE_DEGREES) as ScaleId[]
const VALID_CAPTURE: CaptureMode[] = ['frame', 'average']

describe('PRESETS library', () => {
  it('contains the 10 authored presets, all named', () => {
    expect(PRESETS).toHaveLength(10)
    expect(PRESETS.map((p) => p.name)).toEqual(EXPECTED_NAMES)
  })

  it('has unique ids', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset has a one-line hint and a group', () => {
    for (const p of PRESETS) {
      expect(p.hint.length).toBeGreaterThan(0)
      expect(p.hint).not.toContain('\n')
      expect(p.group.length).toBeGreaterThan(0)
    }
  })

  it('references a valid generated source id', () => {
    for (const p of PRESETS) {
      expect(GENERATED_SOURCE_IDS).toContain<GeneratedSourceId>(p.source)
    }
  })

  it('uses a valid scale and capture strategy', () => {
    for (const p of PRESETS) {
      expect(VALID_SCALES).toContain<ScaleId>(p.patch.scale)
      expect(VALID_CAPTURE).toContain<CaptureMode>(p.captureStrategy)
    }
  })

  it('has a modest calibration trim (within ±6 dB)', () => {
    for (const p of PRESETS) {
      expect(Number.isFinite(p.calibrationDb)).toBe(true)
      expect(Math.abs(p.calibrationDb)).toBeLessThanOrEqual(6)
    }
  })

  it('declares the current preset schema version on each patch', () => {
    for (const p of PRESETS) {
      expect(p.patch.schemaVersion).toBe(PRESET_SCHEMA_VERSION)
      // presetId should match the preset id for a coherent round-trip.
      expect(p.patch.presetId).toBe(p.id)
    }
  })

  it('uses each of the 4 generated sources at least once (musical spread)', () => {
    const used = new Set(PRESETS.map((p) => p.source))
    for (const src of GENERATED_SOURCE_IDS) expect(used.has(src)).toBe(true)
  })
})

describe('preset patches round-trip through sanitizePatch unchanged', () => {
  it('sanitizePatch(patch) deep-equals the authored patch', () => {
    for (const p of PRESETS) {
      const sanitized = sanitizePatch(p.patch)
      expect(sanitized, `preset "${p.id}" must sanitize unchanged`).toEqual(p.patch)
    }
  })

  it('XY mapping axes use valid params and ordered/finite ranges', () => {
    for (const p of PRESETS) {
      for (const axis of [p.xyMapping.x, p.xyMapping.y]) {
        expect(typeof axis.param).toBe('string')
        expect(Number.isFinite(axis.min)).toBe(true)
        expect(Number.isFinite(axis.max)).toBe(true)
        expect(axis.max).toBeGreaterThanOrEqual(axis.min)
      }
    }
  })
})

describe('presets resolve to valid worklet params', () => {
  it('resolveParams over each preset stays finite & in range', () => {
    for (const p of PRESETS) {
      const out = resolveParams(p.patch, p.xyMapping)
      expect(Number.isFinite(out.shift)).toBe(true)
      expect(out.blur).toBeGreaterThanOrEqual(0)
      expect(out.blur).toBeLessThanOrEqual(1)
      expect(out.harmonyVoices).toBeGreaterThanOrEqual(0)
      expect(out.harmonyVoices).toBeLessThanOrEqual(MAX_HARMONY_VOICES)
      expect(Number.isInteger(out.harmonyVoices)).toBe(true)
      expect(out.stereoWidth).toBeGreaterThanOrEqual(0)
      expect(out.stereoWidth).toBeLessThanOrEqual(1)
    }
  })
})

describe('getPreset', () => {
  it('returns the matching preset by id', () => {
    const p = getPreset('glass-memory')
    expect(p).toBeDefined()
    expect(p?.name).toBe('Glass Memory')
  })

  it('finds every authored id', () => {
    for (const preset of PRESETS) {
      expect(getPreset(preset.id)).toBe(preset)
    }
  })

  it('returns undefined for an unknown id', () => {
    expect(getPreset('does-not-exist')).toBeUndefined()
    expect(getPreset('')).toBeUndefined()
  })
})

describe('presets are musically distinct', () => {
  it('no two presets share an identical params signature', () => {
    const sigs = PRESETS.map((p) =>
      JSON.stringify([
        p.patch.params.freeze,
        p.patch.params.phaseMotion,
        p.patch.params.tilt,
        p.patch.params.formant,
        p.patch.params.blur,
        p.patch.params.harmonyInterval,
        p.patch.params.reverbAmount,
        p.patch.scale,
      ]),
    )
    expect(new Set(sigs).size).toBe(PRESETS.length)
  })
})
