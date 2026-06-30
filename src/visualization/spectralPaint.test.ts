import { describe, expect, it } from 'vitest'
import { DISPLAY_BINS } from '../audio/contracts'
import {
  DB_CEIL,
  DB_FLOOR,
  accumulatePersistence,
  binToX,
  clampXY,
  dbToNorm,
  dbToY,
  energyColor,
  frozenColor,
  hasEnergy,
} from './spectralPaint'

describe('dbToNorm / dbToY', () => {
  it('maps the floor to 0 and the ceiling to 1', () => {
    expect(dbToNorm(DB_FLOOR)).toBe(0)
    expect(dbToNorm(DB_CEIL)).toBe(1)
  })

  it('is monotonic non-decreasing in dB', () => {
    let prev = -Infinity
    for (let db = DB_FLOOR; db <= DB_CEIL; db += 5) {
      const n = dbToNorm(db)
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  it('clamps out-of-range and never returns NaN', () => {
    expect(dbToNorm(50)).toBe(1)
    expect(dbToNorm(-500)).toBe(0)
    expect(dbToNorm(NaN)).toBe(0)
    expect(dbToNorm(Infinity)).toBeGreaterThanOrEqual(0)
  })

  it('dbToY: louder is higher on screen and stays within [0,height]', () => {
    const h = 200
    const loud = dbToY(DB_CEIL, h)
    const quiet = dbToY(DB_FLOOR, h)
    expect(loud).toBe(0)
    expect(quiet).toBe(h)
    expect(loud).toBeLessThan(quiet)
    expect(dbToY(-30, h)).toBeGreaterThanOrEqual(0)
    expect(dbToY(-30, h)).toBeLessThanOrEqual(h)
  })

  it('dbToY tolerates a zero/invalid height', () => {
    expect(dbToY(-20, 0)).toBe(0)
    expect(dbToY(-20, NaN)).toBe(0)
  })
})

describe('binToX', () => {
  const W = 1000

  it('covers the full [0,width] range at the endpoints', () => {
    expect(binToX(0, W)).toBe(0)
    expect(binToX(DISPLAY_BINS - 1, W)).toBeCloseTo(W, 5)
  })

  it('is monotonically increasing across bins', () => {
    let prev = -1
    for (let i = 0; i < DISPLAY_BINS; i++) {
      const x = binToX(i, W)
      expect(x).toBeGreaterThan(prev)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(W)
      prev = x
    }
  })

  it('gives the low end more horizontal room (log axis)', () => {
    // First quarter of bins should occupy more than a quarter of the width.
    const quarterBin = Math.floor(DISPLAY_BINS / 4)
    expect(binToX(quarterBin, W)).toBeGreaterThan(W / 4)
  })

  it('tolerates a degenerate width or bin count', () => {
    expect(binToX(5, 0)).toBe(0)
    expect(binToX(0, W, 1)).toBe(0)
  })
})

describe('energyColor', () => {
  it('ramps emission-line hues from a cool low to the H-alpha red peak', () => {
    expect(energyColor(0)).toMatch(/^rgb\(/)
    const peak = energyColor(1)
    expect(peak).toMatch(/^rgb\(239, 93, 108\)$/) // H-alpha red ef5d6c
  })

  it('clamps and never produces NaN channels', () => {
    expect(energyColor(2)).toBe(energyColor(1))
    expect(energyColor(-5)).toBe(energyColor(0))
    expect(energyColor(NaN)).not.toContain('NaN')
  })

  it('emits rgba when an alpha is supplied', () => {
    expect(energyColor(0.5, 0.4)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.4\)$/)
  })
})

describe('frozenColor', () => {
  it('is a single amber hue distinct from the live ramp, brightening with energy', () => {
    const quiet = frozenColor(0)
    const loud = frozenColor(1)
    expect(quiet).toMatch(/^rgba\(/)
    expect(loud).toMatch(/^rgba\(/)
    // Higher energy → brighter (larger red channel), confirming brightness ramp.
    const redOf = (s: string) => Number(s.slice(s.indexOf('(') + 1, s.indexOf(',')))
    expect(redOf(loud)).toBeGreaterThan(redOf(quiet))
  })

  it('never produces NaN and honors alpha', () => {
    expect(frozenColor(NaN)).not.toContain('NaN')
    expect(frozenColor(0.5, 0.3)).toMatch(/, 0\.3\)$/)
  })
})

describe('accumulatePersistence', () => {
  it('rises instantly to the live value', () => {
    const acc = new Float32Array(4)
    const live = new Float32Array([DB_CEIL, -50, -75, DB_FLOOR])
    accumulatePersistence(acc, live, 0.9)
    expect(acc[0]).toBe(1)
    expect(acc[3]).toBe(0)
    expect(acc[1]).toBeCloseTo(dbToNorm(-50), 5)
  })

  it('decays toward the floor when input goes silent, staying bounded & finite', () => {
    const acc = new Float32Array([1, 1, 1, 1])
    let last = 1
    for (let frame = 0; frame < 200; frame++) {
      accumulatePersistence(acc, null, 0.8)
      for (const v of acc) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      expect(acc[0]).toBeLessThanOrEqual(last)
      last = acc[0]
    }
    expect(acc[0]).toBeCloseTo(0, 3)
  })

  it('clamps the decay factor and survives poisoned input', () => {
    const acc = new Float32Array([0.5, NaN, Infinity])
    accumulatePersistence(acc, null, 5) // decay > 1 must be clamped to 1
    expect(acc[0]).toBe(0.5)
    expect(Number.isFinite(acc[1])).toBe(true)
    expect(Number.isFinite(acc[2])).toBe(true)
  })

  it('handles all-floor (silence) without NaN', () => {
    const acc = new Float32Array(DISPLAY_BINS)
    const silence = new Float32Array(DISPLAY_BINS).fill(DB_FLOOR)
    accumulatePersistence(acc, silence, 0.85)
    for (const v of acc) expect(v).toBe(0)
  })
})

describe('hasEnergy', () => {
  it('is false for null, empty, and all-floor silence', () => {
    expect(hasEnergy(null)).toBe(false)
    expect(hasEnergy(undefined)).toBe(false)
    expect(hasEnergy(new Float32Array(0))).toBe(false)
    expect(hasEnergy(new Float32Array(DISPLAY_BINS).fill(DB_FLOOR))).toBe(false)
  })

  it('is true when any bin lifts above the floor', () => {
    const s = new Float32Array(DISPLAY_BINS).fill(DB_FLOOR)
    s[42] = -20
    expect(hasEnergy(s)).toBe(true)
  })
})

describe('clampXY', () => {
  it('clamps both axes to the unit square', () => {
    expect(clampXY(2, -1)).toEqual({ x: 1, y: 0 })
    expect(clampXY(0.3, 0.7)).toEqual({ x: 0.3, y: 0.7 })
  })

  it('coerces non-finite (NaN/Infinity) to 0', () => {
    expect(clampXY(NaN, Infinity)).toEqual({ x: 0, y: 0 })
  })
})
