// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useEngine } from './useEngine'
import { createInitialState, type AppState, type Action } from './state'
import { createMockEngine, type MockEngine } from './testMockEngine'
import { quantizeNote } from '../instrument/scales'
import { DEFAULT_PATCH } from '../audio/contracts'

/**
 * Drive useEngine with a controllable state ref + a mock engine, mirroring how
 * App wires them. We bypass the reducer dispatch's React loop by mutating the
 * ref directly for the patch fields the note-flow reads (octave, scale).
 */
function setup(patchOverrides: Partial<typeof DEFAULT_PATCH> = {}) {
  const engine = createMockEngine()
  const result = renderHook(() => {
    const stateRef = useRef<AppState>(
      createInitialState({ ...DEFAULT_PATCH, ...patchOverrides }),
    )
    const dispatchNoop = (_: Action) => {}
    const controls = useEngine({ stateRef, dispatch: dispatchNoop, engineFactory: () => engine })
    return { controls, stateRef }
  })
  return { engine, result }
}

function noteOnCalls(engine: MockEngine): Array<{ note: number; velocity: number }> {
  return engine.calls
    .filter((c) => c.method === 'noteOn')
    .map((c) => ({ note: c.args[0] as number, velocity: c.args[1] as number }))
}
function noteOffCalls(engine: MockEngine): number[] {
  return engine.calls.filter((c) => c.method === 'noteOff').map((c) => c.args[0] as number)
}

describe('note-playing flow — quantization + octave', () => {
  it('quantizes raw note + octave*12 against the patch scale before noteOn', () => {
    const { engine, result } = setup({ scale: 'major', octave: 1 })
    // C#5 = 61. With octave +1 → 73, quantized to C major → 72 (ties round down).
    const expected = quantizeNote(61 + 1 * 12, 'major')
    expect(expected).toBe(72)
    act(() => result.result.current.controls.noteOn(61, 100))
    expect(noteOnCalls(engine)).toEqual([{ note: 72, velocity: 100 }])
  })

  it('note-off releases the SAME quantized note that was sounded', () => {
    const { engine, result } = setup({ scale: 'major', octave: 1 })
    act(() => result.result.current.controls.noteOn(61, 90))
    act(() => result.result.current.controls.noteOff(61))
    expect(noteOffCalls(engine)).toEqual([72])
  })

  it('chromatic scale passes the note through (plus octave)', () => {
    const { engine, result } = setup({ scale: 'chromatic', octave: -1 })
    act(() => result.result.current.controls.noteOn(60, 80))
    expect(noteOnCalls(engine)).toEqual([{ note: 48, velocity: 80 }])
  })

  it('an unmatched note-off is ignored (no engine call)', () => {
    const { engine, result } = setup()
    act(() => result.result.current.controls.noteOff(99))
    expect(noteOffCalls(engine)).toEqual([])
  })
})
