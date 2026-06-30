import { describe, it, expect } from 'vitest'
import { resolveParams, MACRO_TARGETS, MACRO_LABELS } from './macros'
import { pulseModulation } from './motion'
import {
  DEFAULT_PATCH,
  DEFAULT_PARAMS,
  DEFAULT_XY_MAPPING,
  MACRO_IDS,
  MAX_HARMONY_VOICES,
  sanitizeParams,
} from '../audio/contracts'
import type {
  SpectralPatch,
  SpectralParams,
  XYMapping,
} from '../audio/contracts'

// A patch with a clearly non-default hand-edited baseline so we can tell
// "macro overwrote" from "baseline left intact".
function baselinePatch(over: Partial<SpectralPatch> = {}): SpectralPatch {
  return {
    ...DEFAULT_PATCH,
    params: {
      ...DEFAULT_PARAMS,
      tilt: 0.9,
      formant: 6,
      gate: 0.33,
      phaseMotion: 0.77,
      blur: 0.66,
      reverbAmount: 0.11,
      stereoWidth: 0.22,
      harmonyVoices: 1,
      harmonyMix: 0.15,
    },
    macros: { body: 0.0, motion: 1.0, harmony: 1.0, space: 1.0 },
    macroLinks: { body: false, motion: false, harmony: false, space: false },
    // No XY influence by default: a zero-range axis can't move anything off its
    // baseline within the param. Use shift/blur with collapsed ranges.
    xy: { x: 0, y: 0 },
    ...over,
  }
}

// XY mapping whose axes target params no macro touches, with collapsed ranges
// so XY is a no-op — isolates macro behaviour in tests.
const NEUTRAL_XY: XYMapping = {
  x: { param: 'transpose', min: 0, max: 0 },
  y: { param: 'bendRange', min: 2, max: 2 },
}

describe('MACRO_TARGETS / MACRO_LABELS', () => {
  it('defines targets and labels for every macro id', () => {
    for (const id of MACRO_IDS) {
      expect(Array.isArray(MACRO_TARGETS[id])).toBe(true)
      expect(MACRO_TARGETS[id].length).toBeGreaterThan(0)
      expect(typeof MACRO_LABELS[id]).toBe('string')
    }
    expect(MACRO_LABELS).toEqual({ body: 'BODY', motion: 'MOTION', harmony: 'HARMONY', space: 'SPACE' })
  })
})

describe('resolveParams — takeover model', () => {
  it('leaves all target params at baseline when every macro is unlinked', () => {
    const patch = baselinePatch()
    const out = resolveParams(patch, NEUTRAL_XY)
    // None of the macro targets should have moved from the (sanitized) baseline.
    expect(out.tilt).toBeCloseTo(0.9)
    expect(out.formant).toBeCloseTo(6)
    expect(out.gate).toBeCloseTo(0.33)
    expect(out.phaseMotion).toBeCloseTo(0.77)
    expect(out.blur).toBeCloseTo(0.66)
    expect(out.reverbAmount).toBeCloseTo(0.11)
    expect(out.stereoWidth).toBeCloseTo(0.22)
    expect(out.harmonyVoices).toBe(1)
    expect(out.harmonyMix).toBeCloseTo(0.15)
  })

  it('a linked macro overwrites exactly its target params', () => {
    // Link only BODY; value 1 → tilt 0.6, formant 7, gate 0.4.
    const patch = baselinePatch({
      macros: { body: 1, motion: 1, harmony: 1, space: 1 },
      macroLinks: { body: true, motion: false, harmony: false, space: false },
    })
    const out = resolveParams(patch, NEUTRAL_XY)
    // BODY targets overwritten:
    expect(out.tilt).toBeCloseTo(0.6)
    expect(out.formant).toBeCloseTo(7)
    expect(out.gate).toBeCloseTo(0.4)
    // Non-BODY targets untouched (still baseline):
    expect(out.phaseMotion).toBeCloseTo(0.77)
    expect(out.blur).toBeCloseTo(0.66)
    expect(out.reverbAmount).toBeCloseTo(0.11)
  })

  it('body=0 maps to the low end of each target range', () => {
    const patch = baselinePatch({
      macros: { body: 0, motion: 1, harmony: 1, space: 1 },
      macroLinks: { body: true, motion: false, harmony: false, space: false },
    })
    const out = resolveParams(patch, NEUTRAL_XY)
    expect(out.tilt).toBeCloseTo(-1)
    expect(out.formant).toBeCloseTo(-7)
    expect(out.gate).toBeCloseTo(0)
  })

  it('motion / harmony map their target ranges when linked', () => {
    const patch = baselinePatch({
      macros: { body: 0, motion: 1, harmony: 1, space: 0 },
      macroLinks: { body: false, motion: true, harmony: true, space: false },
    })
    const out = resolveParams(patch, NEUTRAL_XY)
    // motion=1 → phaseMotion 1, blur 0.7
    expect(out.phaseMotion).toBeCloseTo(1)
    expect(out.blur).toBeCloseTo(0.7)
    // harmony=1 → voices MAX, mix 0.9
    expect(out.harmonyVoices).toBe(MAX_HARMONY_VOICES)
    expect(out.harmonyMix).toBeCloseTo(0.9)
  })

  it('SPACE wins the stereoWidth conflict when both harmony+space are linked', () => {
    // harmony=1 would set width 0.7; space=1 sets width 1. SPACE is applied last.
    const patch = baselinePatch({
      macros: { body: 0, motion: 0, harmony: 1, space: 1 },
      macroLinks: { body: false, motion: false, harmony: true, space: true },
    })
    const out = resolveParams(patch, NEUTRAL_XY)
    expect(out.stereoWidth).toBeCloseTo(1)
    // SPACE targets also fully applied:
    expect(out.reverbAmount).toBeCloseTo(0.85)
    expect(out.earlyReflections).toBeCloseTo(0.7)
    expect(out.diffusion).toBeCloseTo(0.8)
    // HARMONY still contributes mix even though SPACE owns width:
    expect(out.harmonyMix).toBeCloseTo(0.9)
  })
})

describe('resolveParams — XY surface', () => {
  it('maps each axis within its declared range', () => {
    const patch = baselinePatch({ xy: { x: 0, y: 1 } })
    // x→shift [-12,12] at 0 = -12 ; y→blur [0,1] at 1 = 1
    const out = resolveParams(patch, DEFAULT_XY_MAPPING)
    expect(out.shift).toBeCloseTo(-12)
    expect(out.blur).toBeCloseTo(1)

    const patch2 = baselinePatch({ xy: { x: 1, y: 0 } })
    const out2 = resolveParams(patch2, DEFAULT_XY_MAPPING)
    expect(out2.shift).toBeCloseTo(12)
    expect(out2.blur).toBeCloseTo(0)
  })

  it('XY is applied after macros (rides on top of the same param)', () => {
    // MOTION linked sets blur 0.7; then y-axis blur range [0,1] at 0 overrides → 0.
    const patch = baselinePatch({
      macros: { body: 0, motion: 1, harmony: 0, space: 0 },
      macroLinks: { body: false, motion: true, harmony: false, space: false },
      xy: { x: 0.5, y: 0 },
    })
    const out = resolveParams(patch, DEFAULT_XY_MAPPING)
    expect(out.blur).toBeCloseTo(0)
  })

  it('defaults to DEFAULT_XY_MAPPING when no mapping is passed', () => {
    const patch = baselinePatch({ xy: { x: 0.5, y: 0.5 } })
    const out = resolveParams(patch)
    expect(out.shift).toBeCloseTo(0) // midpoint of [-12,12]
    expect(out.blur).toBeCloseTo(0.5)
  })

  it('rounds an integer-valued XY target (harmonyVoices)', () => {
    const xy: XYMapping = {
      x: { param: 'harmonyVoices', min: 0, max: MAX_HARMONY_VOICES },
      y: { param: 'bendRange', min: 2, max: 2 },
    }
    const patch = baselinePatch({ xy: { x: 0.5, y: 0 } })
    const out = resolveParams(patch, xy)
    expect(Number.isInteger(out.harmonyVoices)).toBe(true)
    expect(out.harmonyVoices).toBe(2)
  })
})

describe('resolveParams — always finite & in-range under extremes', () => {
  const NUMERIC_BOUNDS: Partial<Record<keyof SpectralParams, [number, number]>> = {
    morph: [0, 1],
    shift: [-24, 24],
    formant: [-24, 24],
    blur: [0, 1],
    tilt: [-1, 1],
    gate: [0, 1],
    harmonyVoices: [0, MAX_HARMONY_VOICES],
    harmonyMix: [0, 1],
    phaseMotion: [0, 1],
    sustain: [0, 1],
    stereoWidth: [0, 1],
    earlyReflections: [0, 1],
    reverbAmount: [0, 1],
    diffusion: [0, 1],
    inputGainDb: [-24, 24],
    outputGainDb: [-24, 24],
    transpose: [-24, 24],
    bendRange: [0, 24],
  }

  function assertInRange(p: SpectralParams) {
    for (const [k, bounds] of Object.entries(NUMERIC_BOUNDS)) {
      const v = p[k as keyof SpectralParams] as number
      expect(Number.isFinite(v), `${k} finite`).toBe(true)
      expect(v, `${k} >= min`).toBeGreaterThanOrEqual(bounds![0])
      expect(v, `${k} <= max`).toBeLessThanOrEqual(bounds![1])
    }
    expect(Number.isInteger(p.harmonyVoices)).toBe(true)
  }

  it('clamps malformed baseline, extreme macros, and out-of-range XY', () => {
    const wild: SpectralParams = {
      ...DEFAULT_PARAMS,
      shift: Number.POSITIVE_INFINITY,
      formant: -999,
      blur: 5,
      tilt: -7,
      gate: NaN,
      harmonyVoices: 99,
      harmonyMix: 4,
      stereoWidth: -3,
      reverbAmount: 2,
    }
    const patch: SpectralPatch = {
      ...DEFAULT_PATCH,
      params: wild,
      macros: { body: 5, motion: -2, harmony: 99, space: NaN } as never,
      macroLinks: { body: true, motion: true, harmony: true, space: true },
      xy: { x: 9, y: -9 },
    }
    const xy: XYMapping = {
      x: { param: 'shift', min: -1000, max: 1000 },
      y: { param: 'reverbAmount', min: -5, max: 5 },
    }
    const out = resolveParams(patch, xy)
    assertInRange(out)
  })

  it('sweeps every macro/XY corner and stays in range', () => {
    const corners = [0, 0.5, 1]
    for (const b of corners)
      for (const m of corners)
        for (const x of corners) {
          const patch: SpectralPatch = {
            ...DEFAULT_PATCH,
            macros: { body: b, motion: m, harmony: x, space: b },
            macroLinks: { body: true, motion: true, harmony: true, space: true },
            xy: { x, y: m },
          }
          assertInRange(resolveParams(patch, DEFAULT_XY_MAPPING))
        }
  })

  it('result equals sanitizeParams of itself (idempotent boundary)', () => {
    const patch = baselinePatch({
      macros: { body: 0.3, motion: 0.6, harmony: 0.9, space: 0.4 },
      macroLinks: { body: true, motion: true, harmony: true, space: true },
      xy: { x: 0.2, y: 0.8 },
    })
    const out = resolveParams(patch, DEFAULT_XY_MAPPING)
    expect(sanitizeParams(out)).toEqual(out)
  })
})

describe('resolveParams — purity', () => {
  it('does not mutate the input patch', () => {
    const patch = baselinePatch({
      macros: { body: 1, motion: 1, harmony: 1, space: 1 },
      macroLinks: { body: true, motion: true, harmony: true, space: true },
    })
    const before = JSON.stringify(patch)
    resolveParams(patch, DEFAULT_XY_MAPPING)
    expect(JSON.stringify(patch)).toBe(before)
  })

  it('is deterministic for the same input', () => {
    const patch = baselinePatch({ macroLinks: { body: true, motion: true, harmony: true, space: true } })
    const a = resolveParams(patch, DEFAULT_XY_MAPPING)
    const b = resolveParams(patch, DEFAULT_XY_MAPPING)
    expect(a).toEqual(b)
  })
})

describe('pulseModulation', () => {
  it('is bounded within [0,1] across phases and depths', () => {
    for (let d = 0; d <= 1.0001; d += 0.1) {
      for (let p = -2; p <= 3.0001; p += 0.05) {
        const v = pulseModulation(p, d)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('returns a constant 1 at depth 0', () => {
    for (let p = 0; p < 1; p += 0.1) expect(pulseModulation(p, 0)).toBeCloseTo(1)
  })

  it('peaks at the downbeat and dips to (1-depth) at mid-beat', () => {
    expect(pulseModulation(0, 0.8)).toBeCloseTo(1)
    expect(pulseModulation(0.5, 0.8)).toBeCloseTo(0.2)
    expect(pulseModulation(1, 0.8)).toBeCloseTo(1) // wraps to downbeat
  })

  it('is deterministic and phase-periodic', () => {
    expect(pulseModulation(0.25, 0.5)).toBe(pulseModulation(0.25, 0.5))
    expect(pulseModulation(0.3, 0.5)).toBeCloseTo(pulseModulation(1.3, 0.5))
  })

  it('clamps depth and handles non-finite phase', () => {
    expect(pulseModulation(0.5, 2)).toBeCloseTo(0) // depth clamped to 1
    expect(pulseModulation(NaN, 0.5)).toBeCloseTo(1) // phase → 0 (downbeat)
  })
})
