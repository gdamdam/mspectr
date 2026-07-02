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
import { loadInstrument, saveInstrumentBundle } from '../persistence/instruments'
import { getSnapshot } from '../persistence/snapshots'
import { exportInstrumentJson, importInstrumentJson } from '../persistence/exportImport'
import { createInitialState, reducer, hasLiveDerivedSnapshot, type Preferences } from './state'
import { useEngine } from './useEngine'
import { SpectralDisplay } from '../visualization/SpectralDisplay'
import { SourcePanel, soundLabel } from '../components/SourcePanel'
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
  const controls = useEngine({ stateRef, dispatch })
  const [starting, setStarting] = useState(false)
  const [pendingMic, setPendingMic] = useState<{ deviceId?: string } | null>(null)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('evolving')

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
    const params = resolveParams(patch, mapping)
    controls.engine.setParams(params)
    controls.setBendRange(params.bendRange)
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
      controls.setSourcePreset(preset.source, preset.name, preset.patch.params.freeze)
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
    const id = crypto.randomUUID()
    const refA = snapDataRef.current.A ? `${id}:A` : null
    const refB = snapDataRef.current.B ? `${id}:B` : null
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
    await saveInstrumentBundle(inst, snapDataRef.current.A, snapDataRef.current.B)
  }, [])

  const onLoadSession = useCallback(
    async (id: string) => {
      const inst = await loadInstrument(id)
      if (!inst) return
      // Resolve BOTH snapshots before mutating any state. A corrupt snapshot
      // rejects here (surfaced by the caller) and a missing one resolves to
      // null — either way the load is all-or-nothing and can never leave the
      // outgoing session's spectra half-applied under the incoming patch.
      const snapA = inst.snapshotRefA ? await getSnapshot(inst.snapshotRefA) : null
      const snapB = inst.snapshotRefB ? await getSnapshot(inst.snapshotRefB) : null
      dispatch({ type: 'load-patch', patch: inst.patch, sourceLabel: inst.sourceLabel })
      for (const [slot, snap] of [
        ['A', snapA],
        ['B', snapB],
      ] as [SnapshotSlot, SpectralSnapshot | null][]) {
        if (snap) {
          snapDataRef.current[slot] = snap
          controls.loadSnapshotFromSerialized(slot, snap, snap.sourceLabel)
        } else {
          // No ref, or a ref that resolved to nothing — clear so the previous
          // session's spectrum is never left active in this slot.
          clearSnapshot(slot)
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
    const id = crypto.randomUUID()
    const snapshotRefA = snapA ? `${id}:A` : null
    const snapshotRefB = snapB ? `${id}:B` : null
    await saveInstrumentBundle({ ...instrument, id, snapshotRefA, snapshotRefB }, snapA, snapB)
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
          {/* Brand mark — the "Dispersion" logo: a collimated beam strikes a
              prism (its face the 'm' vertex) and splits into the five real
              emission-line hues. Rendered inline so it inherits the palette
              tokens and scales crisply. Decorative; the wordmark carries the
              accessible name. */}
          <svg
            className="topbar__mark"
            viewBox="0 0 128 128"
            width="30"
            height="30"
            aria-hidden="true"
            focusable="false"
          >
            {/* Geometry flattened directly from the approved preview icon
                (logo-1-icon.svg: translate(14,22) scale(0.95)) so the topbar
                mark matches the chosen concept pixel-for-pixel. */}
            {/* incoming collimated beam */}
            <line x1="8.3" y1="67.6" x2="46.3" y2="67.6" stroke="var(--text)" strokeWidth="4.75" strokeLinecap="round" />
            {/* the prism (its left face reads as the 'm' vertex) */}
            <path
              d="M52 39.1 L80.5 103.7 L23.5 103.7 Z"
              fill="var(--text)"
              fillOpacity="0.06"
              stroke="var(--text)"
              strokeWidth="3.8"
              strokeLinejoin="round"
            />
            {/* Dispersed emission bands — discrete, calibrated, not a rainbow.
                Hues are the exact approved-preview values (#8b7bf0 / #46d4f0 /
                #5fe488 / #ffc24b / #ef5d6c) so the mark matches the chosen
                concept rather than drifting to the slightly different UI tokens. */}
            <g strokeWidth="4.75" strokeLinecap="round">
              <line x1="76.7" y1="86.6" x2="112.8" y2="54.3" stroke="#8b7bf0" />
              <line x1="77.7" y1="89.5" x2="114.7" y2="66.7" stroke="#46d4f0" />
              <line x1="78.6" y1="92.3" x2="115.6" y2="79.0" stroke="#5fe488" />
              <line x1="78.6" y1="95.1" x2="114.7" y2="91.3" stroke="#ffc24b" />
              <line x1="77.7" y1="98.0" x2="112.8" y2="103.7" stroke="#ef5d6c" />
            </g>
          </svg>
          <span className="topbar__name">
            mspectr<sup className="topbar__version">v{__APP_VERSION__}</sup>
          </span>
          <span
            className="topbar__tag"
            title="mspectr decomposes a captured sound into its spectral partials — emission-like lines — and lets you play it back as an instrument"
          >
            capture a sound · play what it is made of
          </span>
        </div>
        <nav className="topbar__nav" aria-label="Tools">
          <button
            type="button"
            className="chip"
            title="Save the current instrument and browse or load past sessions"
            onClick={() => dispatch({ type: 'open-modal', modal: 'sessions' })}
          >
            Sessions
          </button>
          <button
            type="button"
            className="chip"
            title="Copy a link that recreates this patch — optionally with its captured spectra"
            onClick={() => dispatch({ type: 'open-modal', modal: 'share' })}
          >
            Share
          </button>
          <button
            type="button"
            className="chip"
            data-active={ui.recording || undefined}
            aria-pressed={ui.recording}
            title="Record your performance to a downloadable WAV file"
            onClick={onRecord}
          >
            {ui.recording ? `Stop · ${ui.recordingSeconds.toFixed(0)}s` : 'Record'}
          </button>
          <button
            type="button"
            className="chip"
            title="Audio quality, motion/intensity, and input monitoring"
            onClick={() => dispatch({ type: 'open-modal', modal: 'settings' })}
          >
            Settings
          </button>
          <button
            type="button"
            className="chip"
            title="What mspectr is and how to play it"
            onClick={() => dispatch({ type: 'open-modal', modal: 'help' })}
          >
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
            onSelectSound={(id) => controls.setSourcePreset(id, soundLabel(id))}
            onPickFile={onPickFile}
            onEnableMic={onEnableMic}
            onEnableTab={onEnableTab}
            listMicDevices={controls.listMicDevices}
            monitor={ui.prefs.monitor}
            onToggleMonitor={(on) => dispatch({ type: 'set-pref', key: 'monitor', value: on })}
          />

          <CapturePanel
            audioStarted={ui.audioStarted}
            liveFrozen={patch.params.freeze}
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
            characterA={ui.snapshotA?.character}
            characterB={ui.snapshotB?.character}
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
