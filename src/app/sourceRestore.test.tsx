// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useEngine } from './useEngine'
import { createInitialState, reducer, type AppState, type Action } from './state'
import { createMockEngine } from './testMockEngine'
import type { PersistedSource } from '../audio/contracts'

function fakeAudioContext(): AudioContext {
  return {
    sampleRate: 48_000,
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      length,
      numberOfChannels: channels,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: { value: 1 },
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    }),
  } as unknown as AudioContext
}

/** useEngine wired to a mock engine + a real reducer dispatch we can inspect. */
function setup(withCtx: boolean) {
  const engine = createMockEngine()
  if (withCtx) (engine as { context: AudioContext | null }).context = fakeAudioContext()
  const actions: Action[] = []
  const result = renderHook(() => {
    const stateRef = useRef<AppState>(createInitialState())
    const dispatch = (a: Action) => {
      actions.push(a)
      stateRef.current = reducer(stateRef.current, a)
    }
    const controls = useEngine({ stateRef, dispatch, engineFactory: () => engine })
    return { controls, stateRef }
  })
  return { actions, result }
}

const typesOf = (actions: Action[], type: Action['type']) => actions.filter((a) => a.type === type)

describe('session source restore (D3)', () => {
  it('reacquires a generated source by id (graph matches the label)', () => {
    const { actions, result } = setup(true)
    const source: PersistedSource = { kind: 'generated', label: 'Bell', generatedId: 'fm-bell' }
    act(() => result.result.current.controls.restoreSource(source))
    const setSource = typesOf(actions, 'set-source')
    expect(setSource.at(-1)).toMatchObject({ kind: 'generated', label: 'Bell', generatedId: 'fm-bell' })
    // Never raises a reselect prompt for a restorable source.
    expect(typesOf(actions, 'source-unavailable')).toHaveLength(0)
  })

  it('prompts to reselect a mic/tab/file source instead of pretending it returned', () => {
    const { actions, result } = setup(false)
    const source: PersistedSource = { kind: 'microphone', label: 'Studio mic', generatedId: null }
    act(() => result.result.current.controls.restoreSource(source))
    expect(typesOf(actions, 'source-unavailable').at(-1)).toMatchObject({ source })
    // The live source is NOT switched to microphone — no false claim.
    expect(typesOf(actions, 'set-source').some((a) => (a as { kind: string }).kind === 'microphone')).toBe(false)
  })

  it('is a no-op for a null source', () => {
    const { actions, result } = setup(true)
    const before = actions.length
    act(() => result.result.current.controls.restoreSource(null))
    expect(actions.length).toBe(before)
  })
})
