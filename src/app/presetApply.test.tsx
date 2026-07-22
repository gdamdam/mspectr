// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { createMockEngine, type MockEngine } from './testMockEngine'
import { PRESETS } from '../performance/presets'
import type { AudioEngineApi } from '../audio/engineApi'
import type { CaptureMode } from '../audio/contracts'

/** captureStrategy → the visible capture-mode radio label. */
const MODE_RADIO: Record<CaptureMode, string> = { frame: 'Single', average: 'Average', evolving: 'Living' }

/** Minimal AudioContext — createGeneratedSource only uses these three members. */
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

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('preset selection applies captureStrategy and calibrationDb (D4)', () => {
  it('seeds the capture mode and pushes loudness calibration to the engine bus', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    // Give the mock a usable context so start() and generated-source creation run.
    ;(engine as { context: AudioContext | null }).context = fakeAudioContext()
    render(<App engineFactory={() => engine as unknown as AudioEngineApi} />)

    // Start audio so the preset picker (disabled until started) becomes enabled.
    await user.click(screen.getByRole('button', { name: /start audio/i }))

    // The Select fires onChange only on a REAL change. To make the target
    // selection deterministic regardless of which preset is active initially,
    // first switch to a known 'evolving' preset, then to the target (which has a
    // non-evolving strategy and non-zero calibration) — so both are guaranteed
    // to differ and to be visible against the defaults.
    const evolving = PRESETS.find((p) => p.captureStrategy === 'evolving')
    const target = PRESETS.find((p) => p.calibrationDb !== 0 && p.captureStrategy !== 'evolving')
    expect(evolving && target).toBeTruthy()
    if (!evolving || !target) return

    const openPicker = () => user.click(screen.getByRole('button', { name: /loads a complete scene/i }))
    await openPicker()
    await user.click(screen.getByRole('option', { name: evolving.name }))
    await openPicker()
    await user.click(screen.getByRole('option', { name: target.name }))

    // calibrationDb resolved from the preset and applied via setCalibration (the
    // instrument bus), NOT folded into outputGainDb.
    const calibrationCalls = (engine as MockEngine).calls.filter((c) => c.method === 'setCalibration')
    expect(calibrationCalls.at(-1)?.args[0]).toBe(target.calibrationDb)

    // captureStrategy seeded the capture-mode control.
    expect(screen.getByRole('radio', { name: MODE_RADIO[target.captureStrategy] })).toBeChecked()
  })
})
