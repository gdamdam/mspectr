// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { createMockEngine, type MockEngine } from './testMockEngine'
import { PRESETS } from '../performance/presets'
import { soundLabel } from '../components/SourcePanel'
import type { AudioEngineApi } from '../audio/engineApi'
import type { CaptureMode, SnapshotSlot, SpectralSnapshot } from '../audio/contracts'

/** A minimal, deterministic snapshot for simulating a capture in jsdom. */
function fakeSnapshot(label: string): SpectralSnapshot {
  const binCount = 8
  return {
    schemaVersion: 1,
    fftSize: 16,
    binCount,
    analysisSampleRate: 48_000,
    baseFrequency: 220,
    frameCount: 1,
    frameHop: 256,
    magnitude: new Float32Array(binCount).fill(0.25),
    phase: null,
    sourceLabel: label,
    capturedAt: 1000,
    isLiveDerived: false,
  }
}

/** Boot the App with a mock engine and start audio so the pickers are enabled. */
async function startedApp() {
  const user = userEvent.setup()
  const engine = createMockEngine()
  ;(engine as { context: AudioContext | null }).context = fakeAudioContext()
  render(<App engineFactory={() => engine as unknown as AudioEngineApi} />)
  await user.click(screen.getByRole('button', { name: /start audio/i }))
  return { user, engine: engine as MockEngine }
}

/** Simulate the engine reporting a captured snapshot into a slot. */
async function emitCapture(engine: MockEngine, slot: SnapshotSlot, label: string) {
  await act(async () => {
    engine.emitSnapshot(slot, fakeSnapshot(label))
  })
}

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

describe('snapshot-clearing semantics on source change (D3)', () => {
  it('selecting a factory preset clears both A and B snapshots (UI + engine)', async () => {
    const { user, engine } = await startedApp()

    // Simulate a live capture into both slots.
    await emitCapture(engine, 'A', 'Captured A')
    await emitCapture(engine, 'B', 'Captured B')
    expect(screen.getByText('Captured A')).toBeInTheDocument()
    expect(screen.getByText('Captured B')).toBeInTheDocument()

    const clearsBefore = engine.calls.filter((c) => c.method === 'clearSnapshot').length

    // Select a factory preset different from the default (index 0) so onChange fires.
    const target = PRESETS.find((p) => p.id !== PRESETS[0].id)!
    await user.click(screen.getByRole('button', { name: /loads a complete scene/i }))
    await user.click(screen.getByRole('option', { name: target.name }))

    // Engine slot state cleared for BOTH slots, and any audition stopped.
    const clears = engine.calls.filter((c) => c.method === 'clearSnapshot')
    expect(clears.length - clearsBefore).toBe(2)
    expect(clears.map((c) => c.args[0])).toEqual(expect.arrayContaining(['A', 'B']))
    expect(engine.calls.some((c) => c.method === 'audition' && c.args[0] === null)).toBe(true)

    // UI metadata cleared: both slots read empty again.
    expect(screen.queryByText('Captured A')).not.toBeInTheDocument()
    expect(screen.queryByText('Captured B')).not.toBeInTheDocument()
    expect(screen.getAllByText('No capture')).toHaveLength(2)
  })

  it('selecting a standalone generated sound PRESERVES snapshots', async () => {
    const { user, engine } = await startedApp()

    await emitCapture(engine, 'A', 'Captured A')
    expect(screen.getByText('Captured A')).toBeInTheDocument()

    const clearsBefore = engine.calls.filter((c) => c.method === 'clearSnapshot').length

    // Pick a built-in sound from the input picker (NOT a full preset scene).
    await user.click(screen.getByRole('button', { name: /built-in sound/i }))
    await user.click(screen.getByRole('option', { name: soundLabel('gong') }))

    // The source swapped (setSourceNode) but NO snapshot was cleared.
    expect(engine.calls.some((c) => c.method === 'setSourceNode')).toBe(true)
    const clearsAfter = engine.calls.filter((c) => c.method === 'clearSnapshot').length
    expect(clearsAfter).toBe(clearsBefore)
    // UI metadata for the captured slot survives the input change.
    expect(screen.getByText('Captured A')).toBeInTheDocument()
  })
})
