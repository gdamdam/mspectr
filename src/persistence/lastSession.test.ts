import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PATCH } from '../audio/contracts'
import { LAST_PATCH_KEY, clearLastPatch, loadLastPatch, saveLastPatch } from './lastSession'

// In-memory localStorage stub so this runs in the node test environment.
beforeEach(() => {
  const store = new Map<string, string>()
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as unknown as { localStorage: typeof mock }).localStorage = mock
})

describe('last-session autosave', () => {
  it('returns undefined when nothing is stored', () => {
    expect(loadLastPatch()).toBeUndefined()
  })

  it('round-trips a saved patch through sanitization', () => {
    const patch = { ...DEFAULT_PATCH, params: { ...DEFAULT_PATCH.params, morph: 0.7, frameSpeed: -1, toneNoise: 0.2 } }
    saveLastPatch(patch)
    const restored = loadLastPatch()
    expect(restored).toBeDefined()
    expect(restored!.params.morph).toBeCloseTo(0.7)
    expect(restored!.params.frameSpeed).toBeCloseTo(-1)
    expect(restored!.params.toneNoise).toBeCloseTo(0.2)
  })

  it('sanitizes malformed stored data instead of throwing', () => {
    localStorage.setItem(LAST_PATCH_KEY, '{"params":{"morph":999,"frameSpeed":"nope"}}')
    const restored = loadLastPatch()
    expect(restored).toBeDefined()
    // Out-of-range morph is clamped; non-numeric frameSpeed falls back to default.
    expect(restored!.params.morph).toBeLessThanOrEqual(1)
    expect(restored!.params.frameSpeed).toBe(DEFAULT_PATCH.params.frameSpeed)
  })

  it('returns undefined on invalid JSON', () => {
    localStorage.setItem(LAST_PATCH_KEY, 'not json{')
    expect(loadLastPatch()).toBeUndefined()
  })

  it('clears the stored session', () => {
    saveLastPatch(DEFAULT_PATCH)
    expect(loadLastPatch()).toBeDefined()
    clearLastPatch()
    expect(loadLastPatch()).toBeUndefined()
  })
})
