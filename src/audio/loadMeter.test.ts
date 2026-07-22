import { describe, expect, it } from 'vitest'
import { LoadMeter } from './loadMeter'

const SR = 48_000
/** Frames in one telemetry window (~12 quanta at 30fps). */
const WINDOW_FRAMES = 128 * 12
/** Real-time budget in ms for that window. */
const BUDGET_MS = (WINDOW_FRAMES / SR) * 1000

describe('LoadMeter', () => {
  it('stays clear and low under a light render load', () => {
    const m = new LoadMeter()
    let flips = 0
    // Render costs ~10% of the deadline every window.
    for (let i = 0; i < 50; i++) if (m.update(BUDGET_MS * 0.1, WINDOW_FRAMES, SR)) flips++
    expect(m.isOverloaded).toBe(false)
    expect(flips).toBe(0)
    expect(m.value).toBeGreaterThan(0.05)
    expect(m.value).toBeLessThan(0.2)
  })

  it('asserts overload once sustained render cost exceeds the deadline, exactly once', () => {
    const m = new LoadMeter()
    let flips = 0
    let flipToOverloadAt = -1
    for (let i = 0; i < 50; i++) {
      // Render taking 120% of real time → genuine scheduling pressure.
      if (m.update(BUDGET_MS * 1.2, WINDOW_FRAMES, SR)) {
        flips++
        if (m.isOverloaded && flipToOverloadAt < 0) flipToOverloadAt = i
      }
    }
    expect(m.isOverloaded).toBe(true)
    expect(flips).toBe(1) // one transition only — no per-window event spam
    expect(flipToOverloadAt).toBeGreaterThanOrEqual(0)
  })

  it('does not flicker when load hovers between the two thresholds (hysteresis)', () => {
    const m = new LoadMeter({ onThreshold: 0.85, offThreshold: 0.6, ema: 1 })
    // ema=1 makes value == last window load, so we can place it precisely.
    expect(m.update(BUDGET_MS * 0.9, WINDOW_FRAMES, SR)).toBe(true) // 0.90 > 0.85 → ON
    expect(m.isOverloaded).toBe(true)
    // Drop to 0.70: above OFF(0.6) so it must STAY overloaded, no flip.
    expect(m.update(BUDGET_MS * 0.7, WINDOW_FRAMES, SR)).toBe(false)
    expect(m.isOverloaded).toBe(true)
    // Drop below OFF → clears, one flip.
    expect(m.update(BUDGET_MS * 0.5, WINDOW_FRAMES, SR)).toBe(true)
    expect(m.isOverloaded).toBe(false)
  })

  it('ignores empty and non-finite windows without changing state', () => {
    const m = new LoadMeter()
    expect(m.update(5, 0, SR)).toBe(false) // no frames
    expect(m.update(NaN, WINDOW_FRAMES, SR)).toBe(false)
    expect(m.value).toBe(0)
    expect(m.isOverloaded).toBe(false)
  })
})
