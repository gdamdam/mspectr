/**
 * App — the single performance screen and the orchestration layer.
 *
 * Responsibilities:
 *  - Hold the reducer state + a live ref of it for the imperative engine hook.
 *  - On every patch change, resolve macros/XY → SpectralParams and push to the
 *    engine, plus quality/seed/polyphony. This is the ONE place audio params are
 *    derived, keeping the macro-takeover model consistent.
 *  - Decode a shared patch/snapshot link from location.hash on first load.
 *  - Mirror prefers-reduced-motion into preferences (user-overridable).
 *  - Cache the heavy SpectralSnapshot objects (Float32Arrays) in a ref, out of
 *    React, so Share/Sessions can embed/export them without re-rendering on
 *    capture.
 *  - Compose the layout + modals.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  DEFAULT_XY_MAPPING,
  INSTRUMENT_SCHEMA_VERSION,
  type CaptureMode,
  type MacroId,
  type QualityMode,
  type ScaleId,
  type SnapshotSlot,
  type SpectralParams,
  type SpectralSnapshot,
  type XYMapping,
  type SavedInstrument,
} from '../audio/contracts'
import { resolveParams } from '../performance/macros'
import { getPreset } from '../performance/presets'
import { decodePatchLink, decodeSnapshotLink } from '../sharing/patchLink'
import { saveInstrument, loadInstrument } from '../persistence/instruments'
import { getSnapshot, putSnapshot } from '../persistence/snapshots'
import { exportInstrumentJson, importInstrumentJson } from '../persistence/exportImport'
import { createInitialState, reducer, hasLiveDerivedSnapshot, type Preferences } from './state'
import { useEngine } from './useEngine'
import { SpectralDisplay } from '../visualization/SpectralDisplay'
import { SourcePanel } from '../components/SourcePanel'
import { CapturePanel } from '../components/CapturePanel'
import { SnapshotSlots } from '../components/SnapshotSlots'
import { MorphControl } from '../components/MorphControl'
import { MacroPanel } from '../components/MacroPanel'
import { PlayBar } from '../components/PlayBar'
import { AdvancedPanel } from '../components/AdvancedPanel'
import { KeyboardPanel } from '../components/KeyboardPanel'
import { MidiPanel } from '../components/MidiPanel'
import { SettingsModal } from '../components/SettingsModal'
import { HelpModal } from '../components/HelpModal'
import { ShareModal } from '../components/ShareModal'
import { SessionsModal } from '../components/SessionsModal'
import { MicWarningModal } from '../components/MicWarningModal'

/** Human label for an XY axis param. Falls back to the raw key. */
function axisLabel(key: keyof SpectralParams): string {
  const map: Partial<Record<keyof SpectralParams, string>> = {
    shift: 'Shift',
    formant: 'Formant',
    blur: 'Blur',
    tilt: 'Tilt',
    gate: 'Gate',
    morph: 'Morph',
    harmonyMix: 'Harmony',
    reverbAmount: 'Reverb',
    phaseMotion: 'Motion',
  }
  return map[key] ?? String(key)
}

function xyMappingFor(presetId: string | null): XYMapping {
  return (presetId ? getPreset(presetId)?.xyMapping : undefined) ?? DEFAULT_XY_MAPPING
}

const PREFS_KEY = 'mspectr.prefs'

function loadPrefs(): Preferences | undefined {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return undefined
    const p = JSON.parse(raw) as Partial<Preferences>
    return {
      reducedMotion: Boolean(p.reducedMotion),
      reducedIntensity: Boolean(p.reducedIntensity),
      monitor: p.monitor === undefined ? true : Boolean(p.monitor),
    }
  } catch {
    return undefined
  }
}

export function App() {
  // Decode any shared link / persisted prefs once, before first render.
  const initial = useMemo(() => {
    const prefs = loadPrefs()
    let patch
    let consent = false
    if (typeof location !== 'undefined' && location.hash.length > 1) {
      const frag = location.hash.slice(1)
      const snap = decodeSnapshotLink(frag)
      if (snap) {
        patch = snap.patch
        consent = Boolean(snap.a?.isLiveDerived || snap.b?.isLiveDerived)
      } else {
        const decoded = decodePatchLink(frag)
        if (decoded) patch = decoded
      }
    }
    const state = createInitialState(patch, prefs)
    if (consent) state.ui.sharedLiveConsent = true
    return { state, frag: typeof location !== 'undefined' ? location.hash.slice(1) : '' }
  }, [])

  const [state, dispatch] = useReducer(reducer, initial.state)
  const stateRef = useRef(state)
  stateRef.current = state

  // Cache of the actual snapshot data (heavy arrays) kept out of React.
  const snapDataRef = useRef<{ A: SpectralSnapshot | null; B: SpectralSnapshot | null }>({ A: null, B: null })
  // Track the last saved/loaded instrument id so Save updates in place.
  const currentInstrumentRef = useRef<string | null>(null)

  const controls = useEngine({ stateRef, dispatch })
  const [starting, setStarting] = useState(false)
  const [pendingMic, setPendingMic] = useState<{ deviceId?: string } | null>(null)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('frame')

  const { patch, ui } = state
  const mapping = useMemo(() => xyMappingFor(patch.presetId), [patch.presetId])
  const xyLabels = useMemo(() => ({ x: axisLabel(mapping.x.param), y: axisLabel(mapping.y.param) }), [mapping])

  // Keep snapshot data cache in sync with engine capture events.
  useEffect(() => {
    const off = controls.engine.onSnapshotCaptured((slot, snap) => {
      snapDataRef.current[slot] = snap
    })
    return off
  }, [controls.engine])

  // --- the single param-resolution effect ----------------------------------
  // Any change to params/macros/xy/links/preset re-resolves and pushes.
  useEffect(() => {
    if (!ui.audioStarted) return
    controls.engine.setParams(resolveParams(patch, mapping))
  }, [controls.engine, ui.audioStarted, patch, mapping])

  useEffect(() => {
    if (!ui.audioStarted) return
    controls.engine.setQuality(patch.quality)
  }, [controls.engine, ui.audioStarted, patch.quality])

  useEffect(() => {
    if (!ui.audioStarted) return
    controls.engine.setSeed(patch.seed)
  }, [controls.engine, ui.audioStarted, patch.seed])

  useEffect(() => {
    if (!ui.audioStarted) return
    controls.engine.setPolyphony(patch.polyphony)
  }, [controls.engine, ui.audioStarted, patch.polyphony])

  // --- preferences: persist + reflect into the document --------------------
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(ui.prefs))
    } catch {
      /* storage may be unavailable; prefs simply won't persist */
    }
    document.documentElement.dataset.reducedMotion = String(ui.prefs.reducedMotion)
    document.documentElement.dataset.reducedIntensity = String(ui.prefs.reducedIntensity)
  }, [ui.prefs])

  // Apply the monitor preference to the engine live, so toggling it mutes/unmutes
  // the source immediately (controls.setMonitor gates to generated sources only).
  useEffect(() => {
    if (!ui.audioStarted) return
    controls.setMonitor(ui.prefs.monitor)
  }, [controls, ui.audioStarted, ui.prefs.monitor, ui.sourceKind])

  // Mirror the OS prefers-reduced-motion once on mount (user can override).
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches && !stateRef.current.ui.prefs.reducedMotion) {
      dispatch({ type: 'set-pref', key: 'reducedMotion', value: true })
    }
    // mount only
  }, [])

  // If a shared link embedded snapshots, load them into the engine on start.
  const sharedAppliedRef = useRef(false)
  useEffect(() => {
    if (!ui.audioStarted || sharedAppliedRef.current) return
    sharedAppliedRef.current = true
    const frag = initial.frag
    if (!frag) return
    const snap = decodeSnapshotLink(frag)
    if (!snap) return
    if (snap.a) {
      snapDataRef.current.A = snap.a
      controls.loadSnapshotFromSerialized('A', snap.a, snap.a.sourceLabel)
    }
    if (snap.b) {
      snapDataRef.current.B = snap.b
      controls.loadSnapshotFromSerialized('B', snap.b, snap.b.sourceLabel)
    }
  }, [ui.audioStarted, controls, initial.frag])

  // --- action handlers ------------------------------------------------------
  const onStart = useCallback(async () => {
    setStarting(true)
    try {
      await controls.start()
    } catch (err) {
      // Surface the real cause: most failures here are the AudioWorklet module
      // failing to load (e.g. dev-mode module-worklet imports on Safari/Firefox)
      // or a blocked AudioContext.
      console.error('[mspectr] audio start failed:', err)
      const detail = err instanceof Error ? err.message : String(err)
      dispatch({
        type: 'set-notice',
        notice: `Audio could not start: ${detail}`,
      })
    } finally {
      setStarting(false)
    }
  }, [controls])

  const onSelectPreset = useCallback(
    (presetId: string) => {
      const preset = getPreset(presetId)
      if (!preset) return
      dispatch({ type: 'load-preset', presetId })
      controls.setSourcePreset(preset.source, preset.name)
    },
    [controls],
  )

  const clearSnapshot = useCallback(
    (slot: SnapshotSlot) => {
      snapDataRef.current[slot] = null
      controls.clearSnapshot(slot)
    },
    [controls],
  )

  const swapSnapshots = useCallback(() => {
    const cur = snapDataRef.current
    snapDataRef.current = { A: cur.B, B: cur.A }
    controls.swapSnapshots()
  }, [controls])

  const copySnapshot = useCallback(
    (from: SnapshotSlot, to: SnapshotSlot) => {
      snapDataRef.current[to] = snapDataRef.current[from]
      controls.copySnapshot(from, to)
    },
    [controls],
  )

  const onEnableMic = useCallback((deviceId?: string) => {
    // Gate behind the feedback warning the first time.
    setPendingMic({ deviceId })
    dispatch({ type: 'open-modal', modal: 'mic-warning' })
  }, [])

  const confirmMic = useCallback(async () => {
    const dev = pendingMic?.deviceId
    setPendingMic(null)
    dispatch({ type: 'open-modal', modal: null })
    try {
      await controls.setMicSource(dev)
    } catch {
      dispatch({ type: 'set-notice', notice: 'Microphone access was denied or unavailable.' })
    }
  }, [controls, pendingMic])

  const onEnableTab = useCallback(async () => {
    try {
      await controls.setTabSource()
    } catch {
      dispatch({ type: 'set-notice', notice: 'Tab audio capture was cancelled or is unsupported.' })
    }
  }, [controls])

  const onPickFile = useCallback(
    async (file: File) => {
      try {
        await controls.setFileSource(file)
      } catch {
        dispatch({ type: 'set-notice', notice: 'That file could not be decoded as audio.' })
      }
    },
    [controls],
  )

  const onRecord = useCallback(async () => {
    if (ui.recording) {
      await controls.stopRecording()
    } else {
      const ok = await controls.startRecording()
      if (!ok) dispatch({ type: 'set-notice', notice: 'Recording needs audio running first.' })
    }
  }, [ui.recording, controls])

  // --- sessions glue --------------------------------------------------------
  const onSaveSession = useCallback(async (name: string) => {
    const now = Date.now()
    const id = currentInstrumentRef.current ?? crypto.randomUUID()
    const refA = snapDataRef.current.A ? `${id}:A` : null
    const refB = snapDataRef.current.B ? `${id}:B` : null
    if (snapDataRef.current.A && refA) await putSnapshot(refA, snapDataRef.current.A)
    if (snapDataRef.current.B && refB) await putSnapshot(refB, snapDataRef.current.B)
    const inst: SavedInstrument = {
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      id,
      name,
      createdAt: now,
      updatedAt: now,
      patch: stateRef.current.patch,
      snapshotRefA: refA,
      snapshotRefB: refB,
      sourceLabel: stateRef.current.ui.sourceLabel,
    }
    await saveInstrument(inst)
    currentInstrumentRef.current = id
  }, [])

  const onLoadSession = useCallback(
    async (id: string) => {
      const inst = await loadInstrument(id)
      if (!inst) return
      currentInstrumentRef.current = id
      dispatch({ type: 'load-patch', patch: inst.patch, sourceLabel: inst.sourceLabel })
      for (const slot of ['A', 'B'] as SnapshotSlot[]) {
        const ref = slot === 'A' ? inst.snapshotRefA : inst.snapshotRefB
        if (!ref) {
          clearSnapshot(slot)
          continue
        }
        const snap = await getSnapshot(ref)
        if (snap) {
          snapDataRef.current[slot] = snap
          controls.loadSnapshotFromSerialized(slot, snap, snap.sourceLabel)
        }
      }
      dispatch({ type: 'open-modal', modal: null })
    },
    [controls, clearSnapshot],
  )

  const onExportSession = useCallback(async (id: string) => {
    const inst = await loadInstrument(id)
    if (!inst) return
    const snapA = inst.snapshotRefA ? await getSnapshot(inst.snapshotRefA) : null
    const snapB = inst.snapshotRefB ? await getSnapshot(inst.snapshotRefB) : null
    const json = exportInstrumentJson(inst, snapA, snapB)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${inst.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'session'}.mspectr.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [])

  const onImportSession = useCallback(async (file: File) => {
    const text = await file.text()
    const { instrument, snapA, snapB } = importInstrumentJson(text)
    if (instrument.snapshotRefA && snapA) await putSnapshot(instrument.snapshotRefA, snapA)
    if (instrument.snapshotRefB && snapB) await putSnapshot(instrument.snapshotRefB, snapB)
    await saveInstrument(instrument)
  }, [])

  const closeModal = useCallback(() => dispatch({ type: 'open-modal', modal: null }), [])

  // --- render ---------------------------------------------------------------
  return (
    <div className="app" data-reduced-intensity={ui.prefs.reducedIntensity || undefined}>
      <a href="#main" className="skip-link">
        Skip to instrument
      </a>

      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          <span className="topbar__name">
            mspectr<sup className="topbar__version">v{__APP_VERSION__}</sup>
          </span>
          <span className="topbar__tag">capture a sound · play what it is made of</span>
        </div>
        <nav className="topbar__nav" aria-label="Tools">
          <button type="button" className="chip" onClick={() => dispatch({ type: 'open-modal', modal: 'sessions' })}>
            Sessions
          </button>
          <button type="button" className="chip" onClick={() => dispatch({ type: 'open-modal', modal: 'share' })}>
            Share
          </button>
          <button
            type="button"
            className="chip"
            data-active={ui.recording || undefined}
            aria-pressed={ui.recording}
            onClick={onRecord}
          >
            {ui.recording ? `Stop · ${ui.recordingSeconds.toFixed(0)}s` : 'Record'}
          </button>
          <button type="button" className="chip" onClick={() => dispatch({ type: 'open-modal', modal: 'settings' })}>
            Settings
          </button>
          <button type="button" className="chip" onClick={() => dispatch({ type: 'open-modal', modal: 'help' })}>
            Help
          </button>
        </nav>
      </header>

      {ui.notice ? (
        <div className="notice" role="alert">
          <span>{ui.notice}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss notice"
            onClick={() => dispatch({ type: 'set-notice', notice: null })}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ) : null}

      {ui.sharedLiveConsent ? (
        <p className="notice notice--info" role="status">
          This shared scene includes spectral data derived from live input, shared with consent.
        </p>
      ) : null}

      <main id="main" className="stage">
        <div className="stage__perform">
          <div className="stage__display">
            <SpectralDisplay
              telemetry={ui.telemetry}
              xy={patch.xy}
              onXYChange={(x, y) => dispatch({ type: 'set-xy', x, y })}
              xyLabels={xyLabels}
              active={ui.audioStarted}
              reducedMotion={ui.prefs.reducedMotion}
              reducedIntensity={ui.prefs.reducedIntensity}
            />
          </div>

          <section className="panel" aria-labelledby="morph-heading">
            <h2 id="morph-heading" className="panel__eyebrow">
              Morph
            </h2>
            <MorphControl
              value={patch.params.morph}
              onChange={(v) => dispatch({ type: 'set-morph', value: v })}
              labelA={ui.snapshotA?.label ?? 'A'}
              labelB={ui.snapshotB?.label ?? 'B'}
              reducedIntensity={ui.prefs.reducedIntensity}
            />
          </section>

          <MacroPanel
            values={patch.macros}
            links={patch.macroLinks}
            onValue={(id: MacroId, v) => dispatch({ type: 'set-macro', id, value: v })}
            onLink={(id: MacroId, linked) => dispatch({ type: 'set-macro-link', id, linked })}
          />
        </div>

        <div className="stage__rack">
          <SourcePanel
            audioStarted={ui.audioStarted}
            sourceKind={ui.sourceKind}
            sourceLabel={ui.sourceLabel}
            starting={starting}
            presetId={patch.presetId}
            onStart={onStart}
            onSelectPreset={onSelectPreset}
            onPickFile={onPickFile}
            onEnableMic={onEnableMic}
            onEnableTab={onEnableTab}
            listMicDevices={controls.listMicDevices}
            monitor={ui.prefs.monitor}
            onToggleMonitor={(on) => dispatch({ type: 'set-pref', key: 'monitor', value: on })}
          />

          <CapturePanel
            audioStarted={ui.audioStarted}
            liveFrozen={ui.liveFrozen}
            captureMode={captureMode}
            onCaptureModeChange={setCaptureMode}
            onCapture={controls.capture}
            onFreeze={controls.freezeLive}
            onClearLive={controls.clearLive}
            onSwap={swapSnapshots}
            onCopy={copySnapshot}
          />

          <SnapshotSlots
            a={ui.snapshotA}
            b={ui.snapshotB}
            auditioning={ui.auditioning}
            onAudition={controls.audition}
            onClear={clearSnapshot}
          />
        </div>
      </main>

      <PlayBar
        audioStarted={ui.audioStarted}
        activeVoices={ui.telemetry?.activeVoices ?? 0}
        overloaded={ui.overloaded}
        octave={patch.octave}
        scale={patch.scale}
        polyphony={patch.polyphony}
        onOctave={(v) => dispatch({ type: 'set-octave', value: v })}
        onScale={(s: ScaleId) => dispatch({ type: 'set-scale', scale: s })}
        onPolyphony={(v) => dispatch({ type: 'set-polyphony', value: v })}
        onPanic={controls.panic}
      />

      <div className="strip">
        <KeyboardPanel enabled={ui.keyboardEnabled} onToggle={(on) => dispatch({ type: 'set-keyboard', enabled: on })} />
        <MidiPanel enabled={ui.midiEnabled} devices={ui.midiDevices} onEnable={() => void controls.enableMidi()} />
      </div>

      <AdvancedPanel
        open={ui.advancedOpen}
        onToggle={() => dispatch({ type: 'toggle-advanced' })}
        params={patch.params}
        quality={patch.quality}
        seed={patch.seed}
        onParam={(key, value) => dispatch({ type: 'edit-param', key, value })}
        onQuality={(q: QualityMode) => dispatch({ type: 'set-quality', quality: q })}
        onSeed={(seed) => dispatch({ type: 'set-seed', seed })}
      />

      {ui.openModal === 'settings' ? (
        <SettingsModal
          prefs={ui.prefs}
          quality={patch.quality}
          onClose={closeModal}
          onPref={(key, value) => dispatch({ type: 'set-pref', key, value })}
          onQuality={(q) => dispatch({ type: 'set-quality', quality: q })}
        />
      ) : null}
      {ui.openModal === 'help' ? <HelpModal onClose={closeModal} /> : null}
      {ui.openModal === 'share' ? (
        <ShareModal
          patch={patch}
          snapshotA={snapDataRef.current.A}
          snapshotB={snapDataRef.current.B}
          hasLiveDerived={hasLiveDerivedSnapshot(ui)}
          onClose={closeModal}
        />
      ) : null}
      {ui.openModal === 'sessions' ? (
        <SessionsModal
          currentName={ui.sourceLabel}
          onClose={closeModal}
          onSave={onSaveSession}
          onLoad={onLoadSession}
          onExport={onExportSession}
          onImport={onImportSession}
        />
      ) : null}
      {ui.openModal === 'mic-warning' ? (
        <MicWarningModal
          onClose={() => {
            setPendingMic(null)
            closeModal()
          }}
          onConfirm={confirmMic}
        />
      ) : null}
    </div>
  )
}
