import { describe, it, expect } from 'vitest'
import {
  reducer,
  createInitialState,
  hasLiveDerivedSnapshot,
  allMacrosLinked,
  type AppState,
} from './state'
import { resolveParams, MACRO_TARGETS } from '../performance/macros'
import { PRESETS } from '../performance/presets'
import { DEFAULT_PATCH } from '../audio/contracts'

function init(): AppState {
  return createInitialState()
}

describe('reducer — preset + patch loading', () => {
  it('load-preset replaces the patch and resets source state', () => {
    const target = PRESETS[3]
    const s = reducer(init(), { type: 'load-preset', presetId: target.id })
    expect(s.patch.presetId).toBe(target.id)
    expect(s.ui.sourceKind).toBe('generated')
    expect(s.ui.sourceLabel).toBe(target.name)
    expect(s.patch.params.freeze).toBe(false)
  })

  it('load-preset with an unknown id is a no-op', () => {
    const before = init()
    const after = reducer(before, { type: 'load-preset', presetId: 'does-not-exist' })
    expect(after).toBe(before)
  })

  it('load-preset records the generated source id', () => {
    const target = PRESETS[3]
    const s = reducer(init(), { type: 'load-preset', presetId: target.id })
    expect(s.ui.generatedId).toBe(target.source)
  })

  it('set-source tracks the generated id and clears any reselect prompt', () => {
    let s = reducer(init(), { type: 'source-unavailable', source: { kind: 'microphone', label: 'Mic', generatedId: null } })
    expect(s.ui.sourceReselect).not.toBeNull()
    s = reducer(s, { type: 'set-source', kind: 'generated', label: 'Bell', generatedId: 'fm-bell' })
    expect(s.ui.sourceKind).toBe('generated')
    expect(s.ui.generatedId).toBe('fm-bell')
    expect(s.ui.sourceReselect).toBeNull()
  })

  it('set-source nulls the generated id for non-generated inputs', () => {
    const s = reducer(init(), { type: 'set-source', kind: 'microphone', label: 'Studio mic' })
    expect(s.ui.sourceKind).toBe('microphone')
    expect(s.ui.generatedId).toBeNull()
  })

  it('source-unavailable raises the reselect prompt without changing the live source', () => {
    const before = init()
    const saved = { kind: 'tab' as const, label: 'Tab audio', generatedId: null }
    const s = reducer(before, { type: 'source-unavailable', source: saved })
    expect(s.ui.sourceReselect).toEqual(saved)
    // The actual (playable) source identity is untouched — no false claim.
    expect(s.ui.sourceKind).toBe(before.ui.sourceKind)
    expect(s.ui.sourceLabel).toBe(before.ui.sourceLabel)
  })

  it('retains an authored live freeze in frozen presets', () => {
    const frozen = PRESETS.find((preset) => preset.patch.params.freeze)
    expect(frozen).toBeDefined()
    const s = reducer(init(), { type: 'load-preset', presetId: frozen!.id })
    expect(s.patch.params.freeze).toBe(true)
  })

  it('load-patch sanitizes malformed shared-link input', () => {
    // Simulate a decoded but corrupt patch (out-of-range / wrong types).
    const malformed = {
      ...DEFAULT_PATCH,
      polyphony: 999,
      octave: 99,
      scale: 'klingon',
      params: { ...DEFAULT_PATCH.params, blur: 5, gate: -3, shift: NaN },
    } as unknown as typeof DEFAULT_PATCH
    const s = reducer(init(), { type: 'load-patch', patch: malformed })
    expect(s.patch.polyphony).toBeLessThanOrEqual(8)
    expect(s.patch.octave).toBeLessThanOrEqual(3)
    expect(s.patch.scale).toBe('chromatic') // fell back
    expect(s.patch.params.blur).toBeLessThanOrEqual(1)
    expect(s.patch.params.gate).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(s.patch.params.shift)).toBe(true)
  })
})

describe('reducer — param + performance edits', () => {
  it('edit-param updates a single raw param immutably', () => {
    const before = init()
    const after = reducer(before, { type: 'edit-param', key: 'blur', value: 0.7 })
    expect(after.patch.params.blur).toBe(0.7)
    expect(before.patch.params.blur).toBe(init().patch.params.blur) // unchanged original
  })

  it('set-xy clamps to the unit square', () => {
    const s = reducer(init(), { type: 'set-xy', x: 2, y: -1 })
    expect(s.patch.xy.x).toBe(1)
    expect(s.patch.xy.y).toBe(0)
  })

  it('set-morph clamps 0..1', () => {
    expect(reducer(init(), { type: 'set-morph', value: 1.5 }).patch.params.morph).toBe(1)
  })

  it('set-macro + set-macro-link record values and link state', () => {
    let s = reducer(init(), { type: 'set-macro', id: 'body', value: 0.9 })
    expect(s.patch.macros.body).toBe(0.9)
    s = reducer(s, { type: 'set-macro-link', id: 'body', linked: false })
    expect(s.patch.macroLinks.body).toBe(false)
    expect(allMacrosLinked(s.patch)).toBe(false)
  })

  it('clamps polyphony and octave', () => {
    expect(reducer(init(), { type: 'set-polyphony', value: 99 }).patch.polyphony).toBe(8)
    expect(reducer(init(), { type: 'set-octave', value: -99 }).patch.octave).toBe(-3)
  })
})

describe('reducer — snapshot metadata', () => {
  it('records capture metadata into the right slot', () => {
    const s = reducer(init(), {
      type: 'snapshot-captured',
      slot: 'A',
      label: 'Glass Memory',
      capturedAt: 1000,
      isLiveDerived: false,
    })
    expect(s.ui.snapshotA).toEqual({ label: 'Glass Memory', capturedAt: 1000, isLiveDerived: false })
    expect(s.ui.snapshotB).toBeNull()
  })

  it('swap exchanges A and B metadata', () => {
    let s = reducer(init(), { type: 'snapshot-captured', slot: 'A', label: 'a', capturedAt: 1, isLiveDerived: false })
    s = reducer(s, { type: 'snapshot-captured', slot: 'B', label: 'b', capturedAt: 2, isLiveDerived: true })
    s = reducer(s, { type: 'swap-snapshots' })
    expect(s.ui.snapshotA?.label).toBe('b')
    expect(s.ui.snapshotB?.label).toBe('a')
  })

  it('copy A→B duplicates metadata', () => {
    let s = reducer(init(), { type: 'snapshot-captured', slot: 'A', label: 'a', capturedAt: 1, isLiveDerived: false })
    s = reducer(s, { type: 'copy-snapshot', from: 'A', to: 'B' })
    expect(s.ui.snapshotB?.label).toBe('a')
  })

  it('clearing an auditioning slot stops audition', () => {
    let s = reducer(init(), { type: 'snapshot-captured', slot: 'A', label: 'a', capturedAt: 1, isLiveDerived: false })
    s = reducer(s, { type: 'set-auditioning', slot: 'A' })
    s = reducer(s, { type: 'clear-snapshot', slot: 'A' })
    expect(s.ui.snapshotA).toBeNull()
    expect(s.ui.auditioning).toBeNull()
  })

  it('hasLiveDerivedSnapshot reflects either slot', () => {
    let s = init()
    expect(hasLiveDerivedSnapshot(s.ui)).toBe(false)
    s = reducer(s, { type: 'snapshot-captured', slot: 'B', label: 'mic', capturedAt: 5, isLiveDerived: true })
    expect(hasLiveDerivedSnapshot(s.ui)).toBe(true)
  })
})

describe('resolveParams integration — macro takeover (linked vs unlinked)', () => {
  it('a linked macro drives its target params', () => {
    // BODY is linked by default; bump it and confirm at least one target moves.
    let s = createInitialState(DEFAULT_PATCH)
    const baseline = resolveParams(s.patch)
    s = reducer(s, { type: 'set-macro', id: 'body', value: 1 })
    const moved = resolveParams(s.patch)
    const targets = MACRO_TARGETS.body
    const changed = targets.some((t) => moved[t] !== baseline[t])
    expect(changed).toBe(true)
  })

  it('an unlinked macro leaves hand-edited params authoritative', () => {
    let s = createInitialState(DEFAULT_PATCH)
    // Unlink BODY, then set one of its targets by hand.
    const target = MACRO_TARGETS.body[0]
    s = reducer(s, { type: 'set-macro-link', id: 'body', linked: false })
    s = reducer(s, { type: 'edit-param', key: target, value: handValueFor(target) })
    // Now sweeping the BODY macro must NOT override the hand-edited target.
    s = reducer(s, { type: 'set-macro', id: 'body', value: 1 })
    const resolved = resolveParams(s.patch)
    expect(resolved[target]).toBe(handValueFor(target))
  })
})

// Pick a safe in-range hand value for whichever param BODY touches first.
function handValueFor(key: string): number {
  // All BODY targets in the contract are 0..1 or signed ranges that include 0.3.
  return key === 'tilt' ? -0.4 : 0.3
}
