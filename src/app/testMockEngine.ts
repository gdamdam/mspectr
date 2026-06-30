/**
 * A no-op AudioEngineApi mock for jsdom tests — no real AudioContext exists in
 * jsdom, so every method just records calls. Listener registration returns a
 * working unsubscribe and the recorded listeners can be invoked manually to
 * simulate telemetry / capture / overload events.
 */
import type {
  AudioEngineApi,
  OverloadListener,
  SnapshotCapturedListener,
  TelemetryListener,
} from '../audio/engineApi'
import type { CaptureMode, QualityMode, SnapshotSlot, SpectralParams, SpectralSnapshot } from '../audio/contracts'

export interface MockEngine extends AudioEngineApi {
  calls: Array<{ method: string; args: unknown[] }>
  telemetryListeners: TelemetryListener[]
  snapshotListeners: SnapshotCapturedListener[]
  overloadListeners: OverloadListener[]
  emitSnapshot(slot: SnapshotSlot, snap: SpectralSnapshot): void
}

export function createMockEngine(): MockEngine {
  const calls: MockEngine['calls'] = []
  const telemetryListeners: TelemetryListener[] = []
  const snapshotListeners: SnapshotCapturedListener[] = []
  const overloadListeners: OverloadListener[] = []
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
    }

  return {
    calls,
    telemetryListeners,
    snapshotListeners,
    overloadListeners,
    context: null,
    running: false,
    start: async () => {
      calls.push({ method: 'start', args: [] })
    },
    suspend: async () => {},
    dispose: async () => {},
    setSourceNode: rec('setSourceNode'),
    setParams: rec('setParams') as (p: SpectralParams) => void,
    setQuality: rec('setQuality') as (q: QualityMode) => void,
    setSeed: rec('setSeed'),
    setPolyphony: rec('setPolyphony'),
    capture: rec('capture') as (slot: SnapshotSlot, mode: CaptureMode) => void,
    loadSnapshot: rec('loadSnapshot'),
    clearSnapshot: rec('clearSnapshot'),
    swapSnapshots: rec('swapSnapshots'),
    copySnapshot: rec('copySnapshot'),
    freezeLive: rec('freezeLive'),
    clearLive: rec('clearLive'),
    noteOn: rec('noteOn'),
    noteOff: rec('noteOff'),
    pitchBend: rec('pitchBend'),
    sustain: rec('sustain'),
    panic: rec('panic'),
    setMonitor: rec('setMonitor'),
    audition: rec('audition'),
    getOutputNode: () => null,
    onTelemetry: (l) => {
      telemetryListeners.push(l)
      return () => {
        const i = telemetryListeners.indexOf(l)
        if (i >= 0) telemetryListeners.splice(i, 1)
      }
    },
    onSnapshotCaptured: (l) => {
      snapshotListeners.push(l)
      return () => {
        const i = snapshotListeners.indexOf(l)
        if (i >= 0) snapshotListeners.splice(i, 1)
      }
    },
    onOverload: (l) => {
      overloadListeners.push(l)
      return () => {
        const i = overloadListeners.indexOf(l)
        if (i >= 0) overloadListeners.splice(i, 1)
      }
    },
    reset: rec('reset'),
    emitSnapshot(slot, snap) {
      for (const l of snapshotListeners) l(slot, snap)
    },
  }
}
