/**
 * Central UI/performance state for mspectr — a single typed reducer.
 *
 * The reducer owns two kinds of state:
 *  1. The persistable `SpectralPatch` (the thing sessions/links save). Every
 *     patch edit funnels through here so a single `resolveParams(patch,
 *     xyMapping)` call (done by the App effect) can push concrete SpectralParams
 *     to the engine. This keeps the macro-takeover model honest: when a macro is
 *     unlinked, its hand-edited param values in `patch.params` stay authoritative.
 *  2. Transient UI state (open modal, source kind, snapshot metadata, telemetry
 *     mirror, devices, recording/link status, preferences). Audio-rate data
 *     (the actual spectrum) is NOT stored here — only the latest telemetry
 *     reference, swapped each ~30fps frame, so React renders are cheap.
 *
 * The reducer is pure and DOM-free so it is exhaustively unit-testable in node.
 */
import {
  MACRO_IDS,
  sanitizePatch,
  type MacroId,
  type QualityMode,
  type ScaleId,
  type SnapshotSlot,
  type SpectralParams,
  type SpectralPatch,
  type EngineTelemetry,
  type GeneratedSourceId,
  type PersistedSource,
} from '../audio/contracts'
import type { Preset } from '../audio/contracts'
import { getPreset, PRESETS } from '../performance/presets'
import type { AudioInputKind } from '../sources/types'

// ---------------------------------------------------------------------------
// Auxiliary state shapes
// ---------------------------------------------------------------------------

/** What the user sees about a captured snapshot slot (the data itself lives in the engine). */
export interface SlotMeta {
  /** Human label of the source the snapshot was captured/loaded from. */
  label: string
  /** Epoch ms of capture, or null when empty. */
  capturedAt: number | null
  /** True for mic/tab-derived snapshots — gates embedded-link sharing. */
  isLiveDerived: boolean
  /** Short auto-derived spectral character tag, e.g. "bright · airy". */
  character?: string
}

export type ModalId =
  | 'sessions'
  | 'share'
  | 'help'
  | 'settings'
  | 'mic-warning'
  | null

export interface Preferences {
  /** Honour prefers-reduced-motion as an explicit, user-overridable toggle. */
  reducedMotion: boolean
  /** Lower visual intensity (dim accents, less glow) for sensitive users. */
  reducedIntensity: boolean
  /** Live monitoring of generated sources through the output. */
  monitor: boolean
}

export interface LinkUiState {
  connected: boolean
  tempo: number
  peers: number
  playing: boolean
}

export interface UiState {
  /** Whether the AudioContext has been started (a user gesture happened). */
  audioStarted: boolean
  /** The active input kind, mirrored for status display. */
  sourceKind: AudioInputKind
  /** Label of the active source (preset name, file name, mic name, …). */
  sourceLabel: string
  /** The active generated-source id, or null when the input isn't generated. */
  generatedId: GeneratedSourceId | null
  /**
   * A source a restored session referenced but that can't be reacquired
   * (mic/tab/file — browser security). Non-null drives a "reselect an input"
   * prompt; the actual audio graph keeps a playable generated source meanwhile.
   * Cleared as soon as the user picks any input.
   */
  sourceReselect: PersistedSource | null
  /** Which slot, if any, is currently being auditioned. */
  auditioning: SnapshotSlot | null
  snapshotA: SlotMeta | null
  snapshotB: SlotMeta | null
  /** Latest telemetry frame for display; replaced wholesale each frame. */
  telemetry: EngineTelemetry | null
  /** True while the worklet reports limiter overload. */
  overloaded: boolean
  openModal: ModalId
  /** Whether the collapsible advanced (raw params) panel is expanded. */
  advancedOpen: boolean
  /** Hardware keyboard playing enabled. */
  keyboardEnabled: boolean
  /** MIDI enabled + discovered device names. */
  midiEnabled: boolean
  midiDevices: string[]
  recording: boolean
  recordingSeconds: number
  link: LinkUiState
  prefs: Preferences
  /** Non-fatal status line shown to the user (errors, hints). Cleared on next gesture. */
  notice: string | null
  /** When a shared link embedded live-derived snapshots, surface that it was consented. */
  sharedLiveConsent: boolean
}

export interface AppState {
  patch: SpectralPatch
  ui: UiState
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'load-preset'; presetId: string }
  | { type: 'load-patch'; patch: SpectralPatch; sourceLabel?: string }
  | { type: 'edit-param'; key: keyof SpectralParams; value: SpectralParams[keyof SpectralParams] }
  | { type: 'set-xy'; x: number; y: number }
  | { type: 'set-morph'; value: number }
  | { type: 'set-macro'; id: MacroId; value: number }
  | { type: 'set-macro-link'; id: MacroId; linked: boolean }
  | { type: 'set-quality'; quality: QualityMode }
  | { type: 'set-seed'; seed: number }
  | { type: 'set-scale'; scale: ScaleId }
  | { type: 'set-polyphony'; value: number }
  | { type: 'set-octave'; value: number }
  | { type: 'audio-started' }
  | { type: 'set-source'; kind: AudioInputKind; label: string; generatedId?: GeneratedSourceId | null }
  | { type: 'source-unavailable'; source: PersistedSource }
  | { type: 'set-auditioning'; slot: SnapshotSlot | null }
  | { type: 'snapshot-captured'; slot: SnapshotSlot; label: string; capturedAt: number; isLiveDerived: boolean; character?: string }
  | { type: 'snapshot-loaded'; slot: SnapshotSlot; meta: SlotMeta }
  | { type: 'clear-snapshot'; slot: SnapshotSlot }
  | { type: 'swap-snapshots' }
  | { type: 'copy-snapshot'; from: SnapshotSlot; to: SnapshotSlot }
  | { type: 'telemetry'; telemetry: EngineTelemetry }
  | { type: 'overload'; active: boolean }
  | { type: 'open-modal'; modal: ModalId }
  | { type: 'toggle-advanced' }
  | { type: 'set-keyboard'; enabled: boolean }
  | { type: 'set-midi'; enabled: boolean }
  | { type: 'set-midi-devices'; devices: string[] }
  | { type: 'set-recording'; recording: boolean; seconds?: number }
  | { type: 'recording-progress'; seconds: number }
  | { type: 'set-link'; link: Partial<LinkUiState> }
  | { type: 'set-pref'; key: keyof Preferences; value: boolean }
  | { type: 'set-notice'; notice: string | null }
  | { type: 'set-shared-consent'; on: boolean }

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_PREFS: Preferences = {
  reducedMotion: false,
  reducedIntensity: false,
  monitor: true,
}

/** The preset shown on first load. First curated entry. */
export const DEFAULT_PRESET: Preset = PRESETS[0]

function initialUi(prefs: Preferences): UiState {
  return {
    audioStarted: false,
    sourceKind: 'generated',
    sourceLabel: DEFAULT_PRESET.name,
    generatedId: DEFAULT_PRESET.source,
    sourceReselect: null,
    auditioning: null,
    snapshotA: null,
    snapshotB: null,
    telemetry: null,
    overloaded: false,
    openModal: null,
    advancedOpen: false,
    keyboardEnabled: false,
    midiEnabled: false,
    midiDevices: [],
    recording: false,
    recordingSeconds: 0,
    link: { connected: false, tempo: 120, peers: 0, playing: false },
    prefs,
    notice: null,
    sharedLiveConsent: false,
  }
}

export function createInitialState(
  patch: SpectralPatch = DEFAULT_PRESET.patch,
  prefs: Preferences = INITIAL_PREFS,
): AppState {
  return { patch: sanitizePatch(patch), ui: initialUi(prefs) }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Hard bounds mirror the contract sanitizer; we clamp here too so the live UI
 * never holds an out-of-range value even before it round-trips a sanitizer. */
function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return v < min ? min : v > max ? max : v
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load-preset': {
      const preset = getPreset(action.presetId)
      if (!preset) return state
      return {
        patch: sanitizePatch(preset.patch),
        ui: {
          ...state.ui,
          sourceKind: 'generated',
          sourceLabel: preset.name,
          generatedId: preset.source,
          sourceReselect: null,
          auditioning: null,
        },
      }
    }

    case 'load-patch':
      return {
        patch: sanitizePatch(action.patch),
        ui: {
          ...state.ui,
          sourceLabel: action.sourceLabel ?? state.ui.sourceLabel,
        },
      }

    case 'edit-param':
      return {
        ...state,
        patch: {
          ...state.patch,
          params: { ...state.patch.params, [action.key]: action.value },
        },
      }

    case 'set-xy':
      return {
        ...state,
        patch: {
          ...state.patch,
          xy: { x: clampNum(action.x, 0, 1), y: clampNum(action.y, 0, 1) },
        },
      }

    case 'set-morph':
      return {
        ...state,
        patch: {
          ...state.patch,
          params: { ...state.patch.params, morph: clampNum(action.value, 0, 1) },
        },
      }

    case 'set-macro':
      return {
        ...state,
        patch: {
          ...state.patch,
          macros: { ...state.patch.macros, [action.id]: clampNum(action.value, 0, 1) },
        },
      }

    case 'set-macro-link':
      return {
        ...state,
        patch: {
          ...state.patch,
          macroLinks: { ...state.patch.macroLinks, [action.id]: action.linked },
        },
      }

    case 'set-quality':
      return { ...state, patch: { ...state.patch, quality: action.quality } }

    case 'set-seed':
      return { ...state, patch: { ...state.patch, seed: clampNum(Math.round(action.seed), 0, 0xffffffff) } }

    case 'set-scale':
      return { ...state, patch: { ...state.patch, scale: action.scale } }

    case 'set-polyphony':
      return { ...state, patch: { ...state.patch, polyphony: clampNum(Math.round(action.value), 1, 8) } }

    case 'set-octave':
      return { ...state, patch: { ...state.patch, octave: clampNum(Math.round(action.value), -3, 3) } }

    case 'audio-started':
      return { ...state, ui: { ...state.ui, audioStarted: true } }

    case 'set-source':
      return {
        ...state,
        ui: {
          ...state.ui,
          sourceKind: action.kind,
          sourceLabel: action.label,
          generatedId: action.kind === 'generated' ? (action.generatedId ?? null) : null,
          // Any real source selection resolves an outstanding reselect prompt.
          sourceReselect: null,
        },
      }

    case 'source-unavailable':
      // A restored session's source can't be reacquired. Surface the prompt but
      // leave the actual (playable) source untouched — never claim it's active.
      return { ...state, ui: { ...state.ui, sourceReselect: action.source } }

    case 'set-auditioning':
      return { ...state, ui: { ...state.ui, auditioning: action.slot } }

    case 'snapshot-captured':
    case 'snapshot-loaded': {
      const meta: SlotMeta =
        action.type === 'snapshot-captured'
          ? { label: action.label, capturedAt: action.capturedAt, isLiveDerived: action.isLiveDerived, character: action.character }
          : action.meta
      return {
        ...state,
        ui: { ...state.ui, [action.slot === 'A' ? 'snapshotA' : 'snapshotB']: meta },
      }
    }

    case 'clear-snapshot':
      return {
        ...state,
        ui: {
          ...state.ui,
          [action.slot === 'A' ? 'snapshotA' : 'snapshotB']: null,
          auditioning: state.ui.auditioning === action.slot ? null : state.ui.auditioning,
        },
      }

    case 'swap-snapshots':
      return {
        ...state,
        ui: { ...state.ui, snapshotA: state.ui.snapshotB, snapshotB: state.ui.snapshotA },
      }

    case 'copy-snapshot': {
      const src = action.from === 'A' ? state.ui.snapshotA : state.ui.snapshotB
      return {
        ...state,
        ui: { ...state.ui, [action.to === 'A' ? 'snapshotA' : 'snapshotB']: src },
      }
    }

    case 'telemetry':
      return { ...state, ui: { ...state.ui, telemetry: action.telemetry } }

    case 'overload':
      return { ...state, ui: { ...state.ui, overloaded: action.active } }

    case 'open-modal':
      return { ...state, ui: { ...state.ui, openModal: action.modal } }

    case 'toggle-advanced':
      return { ...state, ui: { ...state.ui, advancedOpen: !state.ui.advancedOpen } }

    case 'set-keyboard':
      return { ...state, ui: { ...state.ui, keyboardEnabled: action.enabled } }

    case 'set-midi':
      return { ...state, ui: { ...state.ui, midiEnabled: action.enabled } }

    case 'set-midi-devices':
      return { ...state, ui: { ...state.ui, midiDevices: action.devices } }

    case 'set-recording':
      return {
        ...state,
        ui: {
          ...state.ui,
          recording: action.recording,
          recordingSeconds: action.seconds ?? (action.recording ? 0 : state.ui.recordingSeconds),
        },
      }

    case 'recording-progress':
      return { ...state, ui: { ...state.ui, recordingSeconds: action.seconds } }

    case 'set-link':
      return { ...state, ui: { ...state.ui, link: { ...state.ui.link, ...action.link } } }

    case 'set-pref':
      return { ...state, ui: { ...state.ui, prefs: { ...state.ui.prefs, [action.key]: action.value } } }

    case 'set-notice':
      return { ...state, ui: { ...state.ui, notice: action.notice } }

    case 'set-shared-consent':
      return { ...state, ui: { ...state.ui, sharedLiveConsent: action.on } }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Selectors / helpers used by the App + tests
// ---------------------------------------------------------------------------

/** True when either slot holds a live-derived snapshot (sharing-consent gate). */
export function hasLiveDerivedSnapshot(ui: UiState): boolean {
  return Boolean(ui.snapshotA?.isLiveDerived || ui.snapshotB?.isLiveDerived)
}

/** Whether every macro is currently linked (drives the link-all affordance). */
export function allMacrosLinked(patch: SpectralPatch): boolean {
  return MACRO_IDS.every((id) => patch.macroLinks[id])
}
