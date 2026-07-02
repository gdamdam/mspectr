/**
 * useEngine — the single bridge between React state and the imperative audio
 * world. It owns exactly one AudioEngine, the active SourceHandle, the QWERTY
 * keyboard, the MIDI router, and the WAV recorder, and exposes a stable
 * `controls` object the UI calls.
 *
 * Design rules honoured here:
 *  - The AudioContext is created only inside `start()` (a user gesture).
 *  - Audio-rate data never flows through React: telemetry is throttled by the
 *    worklet, so we just mirror the latest frame into the reducer per push.
 *  - Note flow: rawNote → quantizeNote(rawNote + octave*12, scale) → engine.
 *    The exact quantized note is tracked per raw note so note-off releases the
 *    same pitch even if the user changed octave/scale meanwhile.
 *  - Everything is torn down on a real page dismissal (pagehide); a bfcache-
 *    persisted pagehide only suspends so the restored page stays playable.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import { AudioEngine } from '../audio/AudioEngine'
import type { AudioEngineApi } from '../audio/engineApi'
import {
  midiToFreq,
  DEFAULT_XY_MAPPING,
  type CaptureMode,
  type GeneratedSourceId,
  type SnapshotSlot,
  type SpectralSnapshot,
  type XYMapping,
} from '../audio/contracts'
import { snapshotCharacter } from '../components/snapshotCharacter'
import { resolveParams } from '../performance/macros'
import { getPreset, PRESETS } from '../performance/presets'
import { createGeneratedSource } from '../sources/generated'
import { createFileSource } from '../sources/file'
import { createMicSource, listInputDevices } from '../sources/live'
import { createTabSource } from '../sources/tab'
import type { SourceHandle } from '../sources/types'
import { QwertyKeyboard } from '../instrument/keyboard'
import { quantizeNote } from '../instrument/scales'
import { MidiRouter } from '../midi/router'
import { WavRecorder, recordingFilename } from '../recording/wavRecorder'
import type { Action, AppState } from './state'

export interface EngineControls {
  start(): Promise<void>
  setSourcePreset(
    generatedId: Parameters<typeof createGeneratedSource>[1],
    label: string,
    preserveFreeze?: boolean,
  ): void
  setFileSource(file: File): Promise<void>
  setMicSource(deviceId?: string): Promise<void>
  setTabSource(): Promise<void>
  listMicDevices(): Promise<MediaDeviceInfo[]>
  capture(slot: SnapshotSlot, mode: CaptureMode): void
  loadSnapshotFromSerialized(slot: SnapshotSlot, snapshot: SpectralSnapshot, label: string): void
  clearSnapshot(slot: SnapshotSlot): void
  swapSnapshots(): void
  copySnapshot(from: SnapshotSlot, to: SnapshotSlot): void
  freezeLive(on: boolean): void
  clearLive(): void
  audition(slot: SnapshotSlot | null): void
  panic(): void
  setMonitor(on: boolean): void
  enableMidi(): Promise<boolean>
  setBendRange(n: number): void
  noteOn(rawNote: number, velocity: number): void
  noteOff(rawNote: number): void
  startRecording(): Promise<boolean>
  stopRecording(): Promise<void>
  cancelRecording(): void
  /** Read-only access to the engine output node for advanced wiring/tests. */
  readonly engine: AudioEngineApi
  readonly outputNode: () => AudioNode | null
}

interface UseEngineArgs {
  /** Latest app state ref (read at call time, not closed over). */
  stateRef: MutableRefObject<AppState>
  dispatch: Dispatch<Action>
  /** Factory override for tests (mock engine). */
  engineFactory?: () => AudioEngineApi
}

export function useEngine({ stateRef, dispatch, engineFactory }: UseEngineArgs): EngineControls {
  const engineRef = useRef<AudioEngineApi | null>(null)
  if (engineRef.current === null) {
    engineRef.current = engineFactory ? engineFactory() : new AudioEngine()
  }
  const engine = engineRef.current

  const sourceRef = useRef<SourceHandle | null>(null)
  /** Monotonic token so a slow async source swap can't clobber a newer one. */
  const sourceReqRef = useRef(0)
  const keyboardRef = useRef<QwertyKeyboard | null>(null)
  const midiRef = useRef<MidiRouter | null>(null)
  const recorderRef = useRef<WavRecorder | null>(null)
  /** rawNote → the quantized MIDI note actually sounding, for matched release. */
  const soundingRef = useRef<Map<number, number>>(new Map())
  /** quantized note → number of raw keys holding it after scale lock. */
  const quantizedRefs = useRef<Map<number, number>>(new Map())

  // --- engine event subscriptions -----------------------------------------
  useEffect(() => {
    const offTelemetry = engine.onTelemetry((telemetry) => dispatch({ type: 'telemetry', telemetry }))
    const offSnap = engine.onSnapshotCaptured((slot, snap) => {
      dispatch({
        type: 'snapshot-captured',
        slot,
        label: snap.sourceLabel,
        capturedAt: snap.capturedAt,
        isLiveDerived: snap.isLiveDerived,
        character: snapshotCharacter(snap.magnitude, snap.binCount),
      })
    })
    const offOverload = engine.onOverload((active) => dispatch({ type: 'overload', active }))
    return () => {
      offTelemetry()
      offSnap()
      offOverload()
    }
  }, [engine, dispatch])

  // --- note-playing glue ----------------------------------------------------
  const noteOn = useCallback(
    (rawNote: number, velocity: number) => {
      const { patch } = stateRef.current
      const n = quantizeNote(rawNote + patch.octave * 12, patch.scale)
      // If this raw key is already sounding a (possibly different) note, release it first.
      const prev = soundingRef.current.get(rawNote)
      if (prev !== undefined && prev !== n) {
        const remaining = (quantizedRefs.current.get(prev) ?? 1) - 1
        if (remaining <= 0) {
          quantizedRefs.current.delete(prev)
          engine.noteOff(prev)
        } else {
          quantizedRefs.current.set(prev, remaining)
        }
      }
      if (prev === undefined || prev !== n) {
        quantizedRefs.current.set(n, (quantizedRefs.current.get(n) ?? 0) + 1)
      }
      soundingRef.current.set(rawNote, n)
      engine.noteOn(n, velocity)
    },
    [engine, stateRef],
  )

  const noteOff = useCallback(
    (rawNote: number) => {
      const n = soundingRef.current.get(rawNote)
      if (n === undefined) return
      soundingRef.current.delete(rawNote)
      const remaining = (quantizedRefs.current.get(n) ?? 1) - 1
      if (remaining <= 0) {
        quantizedRefs.current.delete(n)
        engine.noteOff(n)
      } else {
        quantizedRefs.current.set(n, remaining)
      }
    },
    [engine],
  )

  const doPanic = useCallback(() => {
    soundingRef.current.clear()
    quantizedRefs.current.clear()
    keyboardRef.current?.releaseAll()
    midiRef.current?.panic()
    engine.panic()
  }, [engine])

  // --- keyboard + midi instances (created once) ----------------------------
  useEffect(() => {
    keyboardRef.current = new QwertyKeyboard({
      onNoteOn: (note, vel) => noteOn(note, vel),
      onNoteOff: (note) => noteOff(note),
    })
    // The instance must be enabled to accept keys; the window listener already
    // gates on the UI "Playing enabled" toggle (ui.keyboardEnabled), so the
    // instance can stay enabled and the toggle is the single source of truth.
    keyboardRef.current.setEnabled(true)
    midiRef.current = new MidiRouter({
      onNoteOn: (note, vel) => noteOn(note, vel),
      onNoteOff: (note) => noteOff(note),
      onPitchBend: (semitones) => engine.pitchBend(semitones),
      onSustain: (on) => engine.sustain(on),
      onPanic: () => doPanic(),
      onDevicesChanged: (names) => dispatch({ type: 'set-midi-devices', devices: names }),
    })
    return () => {
      keyboardRef.current?.releaseAll()
      midiRef.current?.dispose()
      keyboardRef.current = null
      midiRef.current = null
    }
    // doPanic/noteOn/noteOff are stable callbacks; engine/dispatch stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- window key listeners, gated by enabled flag -------------------------
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!stateRef.current.ui.keyboardEnabled) return
      // Ignore when typing into a field or holding a modifier (shortcuts).
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (keyboardRef.current?.handleKeyDown(e.key, e.repeat)) e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => {
      if (keyboardRef.current?.handleKeyUp(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [stateRef])

  // --- source swapping ------------------------------------------------------
  const swapSource = useCallback(
    (
      handle: SourceHandle,
      kind: SourceHandle['kind'],
      label: string,
      monitorSafe: boolean,
      preserveFreeze = false,
    ) => {
      sourceRef.current?.dispose()
      sourceRef.current = handle
      engine.setSourceNode(handle.node)
      engine.clearLive()
      // Feedback safety: only generated sources monitor through the output.
      // Mic/tab stay muted regardless of the monitor preference.
      engine.setMonitor(monitorSafe && stateRef.current.ui.prefs.monitor)
      if (preserveFreeze) {
        engine.freezeLive(true)
      } else {
        engine.freezeLive(false)
        dispatch({ type: 'edit-param', key: 'freeze', value: false })
      }
      dispatch({ type: 'set-source', kind, label })
    },
    [engine, dispatch, stateRef],
  )

  // --- public controls ------------------------------------------------------
  // Key-up is not delivered when focus leaves the page. Treat blur/hidden as a
  // hard performance boundary so neither QWERTY nor MIDI state can drone.
  useEffect(() => {
    const release = () => doPanic()
    const onVisibility = () => {
      if (document.hidden) release()
    }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [doPanic])

  const controls = useMemo<EngineControls>(() => {
    return {
      engine,
      outputNode: () => engine.getOutputNode(),

      async start() {
        await engine.start()
        const ctx = engine.context
        if (!ctx) throw new Error('mspectr: AudioContext unavailable')
        const { patch, ui } = stateRef.current
        // Default source = the generated source behind the current preset.
        const presetSourceId = stateRef.current.patch.presetId
        const handle = createGeneratedSource(ctx, resolveGeneratedSourceId(presetSourceId))
        sourceRef.current = handle
        engine.setSourceNode(handle.node)
        engine.setMonitor(ui.prefs.monitor) // generated → safe to monitor
        // Apply the loaded patch fully.
        engine.setParams(resolveParams(patch, presetXyMapping(presetSourceId)))
        engine.setQuality(patch.quality)
        engine.setSeed(patch.seed)
        engine.setPolyphony(patch.polyphony)
        dispatch({ type: 'audio-started' })
        dispatch({ type: 'set-source', kind: 'generated', label: ui.sourceLabel })
      },

      setSourcePreset(generatedId, label, preserveFreeze = false) {
        const ctx = engine.context
        if (!ctx) return
        // Synchronous, but still bump the token so any async source swap already
        // in flight resolves stale and won't overwrite this preset.
        sourceReqRef.current += 1
        const handle = createGeneratedSource(ctx, generatedId)
        swapSource(handle, 'generated', label, true, preserveFreeze)
      },

      async setFileSource(file) {
        const ctx = engine.context
        if (!ctx) return
        const token = ++sourceReqRef.current
        const handle = await createFileSource(ctx, file)
        // A newer source selection superseded this one while decoding — drop it.
        if (token !== sourceReqRef.current) return handle.dispose()
        swapSource(handle, 'file', handle.label || file.name, true)
      },

      async setMicSource(deviceId) {
        const ctx = engine.context
        if (!ctx) return
        const token = ++sourceReqRef.current
        const handle = await createMicSource(ctx, deviceId)
        if (token !== sourceReqRef.current) return handle.dispose()
        // Mic must NOT monitor — feedback safety.
        swapSource(handle, 'microphone', handle.label || 'Microphone', false)
      },

      async setTabSource() {
        const ctx = engine.context
        if (!ctx) return
        const token = ++sourceReqRef.current
        const handle = await createTabSource(ctx)
        if (token !== sourceReqRef.current) return handle.dispose()
        swapSource(handle, 'tab', handle.label || 'Tab audio', false)
      },

      listMicDevices: () => listInputDevices(),

      capture(slot, mode) {
        const { sourceKind, sourceLabel } = stateRef.current.ui
        engine.capture(slot, mode, {
          sourceLabel,
          capturedAt: Date.now(),
          isLiveDerived: sourceKind === 'microphone' || sourceKind === 'tab',
        })
      },

      loadSnapshotFromSerialized(slot, snapshot, label) {
        engine.loadSnapshot(slot, snapshot)
        dispatch({
          type: 'snapshot-loaded',
          slot,
          meta: { label, capturedAt: snapshot.capturedAt, isLiveDerived: snapshot.isLiveDerived },
        })
      },

      clearSnapshot(slot) {
        engine.clearSnapshot(slot)
        dispatch({ type: 'clear-snapshot', slot })
      },

      swapSnapshots() {
        engine.swapSnapshots()
        dispatch({ type: 'swap-snapshots' })
      },

      copySnapshot(from, to) {
        engine.copySnapshot(from, to)
        dispatch({ type: 'copy-snapshot', from, to })
      },

      freezeLive(on) {
        engine.freezeLive(on)
        dispatch({ type: 'edit-param', key: 'freeze', value: on })
      },

      clearLive() {
        engine.clearLive()
        dispatch({ type: 'edit-param', key: 'freeze', value: false })
      },

      audition(slot) {
        engine.audition(slot)
        dispatch({ type: 'set-auditioning', slot })
      },

      panic: () => doPanic(),

      setMonitor(on) {
        // Only generated sources may monitor; the caller is responsible for the
        // headphone-warning gate before turning this on for any source.
        const kind = stateRef.current.ui.sourceKind
        engine.setMonitor(on && kind === 'generated')
      },

      async enableMidi() {
        const ok = (await midiRef.current?.enable()) ?? false
        dispatch({ type: 'set-midi', enabled: ok })
        if (ok && midiRef.current) dispatch({ type: 'set-midi-devices', devices: midiRef.current.listInputs() })
        return ok
      },

      setBendRange: (n) => midiRef.current?.setBendRange(n),

      noteOn,
      noteOff,

      async startRecording() {
        const ctx = engine.context
        const out = engine.getOutputNode()
        if (!ctx || !out) return false
        const rec = new WavRecorder(ctx, out, { bitDepth: 24, maxSeconds: 600 })
        recorderRef.current = rec
        rec.onProgress((seconds) => dispatch({ type: 'recording-progress', seconds }))
        await rec.start()
        dispatch({ type: 'set-recording', recording: true, seconds: 0 })
        return true
      },

      async stopRecording() {
        const rec = recorderRef.current
        if (!rec) return
        const blob = await rec.stop()
        rec.dispose()
        recorderRef.current = null
        dispatch({ type: 'set-recording', recording: false })
        downloadBlob(blob, recordingFilename(stateRef.current.ui.sourceLabel, new Date()))
      },

      cancelRecording() {
        recorderRef.current?.cancel()
        recorderRef.current?.dispose()
        recorderRef.current = null
        dispatch({ type: 'set-recording', recording: false })
      },
    }
    // controls is stable; its closures read refs at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, noteOn, noteOff, swapSource, doPanic, dispatch])

  // --- teardown on unmount + pagehide --------------------------------------
  useEffect(() => {
    const teardown = (e: PageTransitionEvent) => {
      // Entering the back/forward cache (persisted): the page can be restored
      // intact later, so keep the engine alive and only suspend the context.
      // Disposing here would leave the restored UI (still "audio started")
      // wired to a permanently-dead engine that start() refuses to revive; the
      // engine's own pageshow listener resumes the context on restore.
      if (e.persisted) {
        void engine.suspend()
        return
      }
      try {
        recorderRef.current?.cancel()
        recorderRef.current?.dispose()
        recorderRef.current = null
        sourceRef.current?.dispose()
        sourceRef.current = null
        midiRef.current?.dispose()
        keyboardRef.current?.releaseAll()
        void engine.dispose()
      } catch {
        /* teardown is best-effort */
      }
    }
    window.addEventListener('pagehide', teardown)
    return () => {
      // Do NOT tear down on effect cleanup. The engine is created once and lives
      // for the page lifetime; React StrictMode (dev) runs this cleanup spuriously
      // on mount, which would dispose the singleton and make the next start()
      // throw "AudioEngine disposed". Real teardown happens on pagehide / unload.
      window.removeEventListener('pagehide', teardown)
    }
  }, [engine])

  return controls
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveGeneratedSourceId(presetId: string | null): GeneratedSourceId {
  const preset = presetId ? getPreset(presetId) : undefined
  return preset?.source ?? PRESETS[0].source
}

function presetXyMapping(presetId: string | null): XYMapping {
  const preset = presetId ? getPreset(presetId) : undefined
  return preset?.xyMapping ?? DEFAULT_XY_MAPPING
}

/** midiToFreq re-export kept so callers needn't import contracts directly. */
export { midiToFreq }

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
