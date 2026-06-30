/**
 * mspectr shared contracts.
 *
 * This is the single source of truth for every data shape that crosses a
 * module boundary: the pure DSP core, the AudioWorklet, the main-thread engine
 * adapter, the React UI, persistence, and sharing. Nothing here may import from
 * React, the DOM, the worklet, or any stateful module — it is plain data and
 * pure helpers so it is safe to import from inside the AudioWorklet.
 *
 * Design notes:
 *  - The worklet consumes fully-resolved `SpectralParams`. Macro/XY resolution
 *    happens on the main thread (see performance/macros.ts) so the worklet stays
 *    dumb about performance controls — this mirrors the mgrains macro-takeover
 *    model where hand-edited values remain authoritative when a macro is
 *    unlinked.
 *  - A `SpectralSnapshot` stores derived spectral data (magnitude + optional
 *    phase), never the original waveform. Live-derived snapshots carry a flag so
 *    sharing can require explicit consent.
 *  - Every value that can be persisted, shared, or received over postMessage is
 *    run through a sanitizer that clamps ranges and rejects non-finite numbers,
 *    so malformed input can never reach the DSP loop or allocate unbounded
 *    buffers.
 */

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

export const PATCH_SCHEMA_VERSION = 1
export const SNAPSHOT_SCHEMA_VERSION = 1
export const PRESET_SCHEMA_VERSION = 1
export const INSTRUMENT_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Hard bounds (safety + performance). These are enforced everywhere.
// ---------------------------------------------------------------------------

export const MAX_POLYPHONY = 8
export const MIN_POLYPHONY = 1
export const MAX_HARMONY_VOICES = 4
export const LIMITER_CEILING_DB = -1
/** Seconds of rolling live input retained for freeze/capture. */
export const LIVE_BUFFER_SECONDS = 4
/** Largest FFT we will ever allocate — bounds memory for malformed snapshots. */
export const MAX_FFT_SIZE = 8192
export const MIN_FFT_SIZE = 256
/** Number of (downsampled) bins sent to the UI for the spectral display. */
export const DISPLAY_BINS = 256

// ---------------------------------------------------------------------------
// Quality modes
// ---------------------------------------------------------------------------

export type QualityMode = 'eco' | 'normal' | 'high'

export interface QualityConfig {
  fftSize: number
  /** Hop between successive STFT frames; fftSize/4 → 75% overlap (COLA for Hann). */
  hopSize: number
  /** Max simultaneous voices in this mode. */
  maxVoices: number
  /** UI display refresh target in fps. */
  displayFps: number
}

export const QUALITY_CONFIGS: Record<QualityMode, QualityConfig> = {
  eco: { fftSize: 1024, hopSize: 256, maxVoices: 4, displayFps: 20 },
  normal: { fftSize: 2048, hopSize: 512, maxVoices: 6, displayFps: 30 },
  high: { fftSize: 4096, hopSize: 1024, maxVoices: 8, displayFps: 30 },
}

export function qualityConfig(mode: QualityMode): QualityConfig {
  return QUALITY_CONFIGS[mode] ?? QUALITY_CONFIGS.normal
}

// ---------------------------------------------------------------------------
// Phase strategies for freeze / resynthesis
// ---------------------------------------------------------------------------

/**
 * 'lock'    — reuse the captured phase every frame (stable, can sound static).
 * 'animate' — advance phase from a seeded RNG / accumulator so a freeze stays
 *             alive without obvious buzzing. Deterministic given a seed.
 */
export type PhaseMode = 'lock' | 'animate'

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export type ScaleId = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'dorian' | 'mixolydian'

/** Semitone degrees within an octave for each scale (0 = root). */
export const SCALE_DEGREES: Record<ScaleId, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
}

// ---------------------------------------------------------------------------
// Harmonize interval sets (authored)
// ---------------------------------------------------------------------------

export type IntervalSetId =
  | 'octaves'
  | 'fifths'
  | 'fourths-fifths'
  | 'major-triad'
  | 'minor-triad'
  | 'cluster'
  | 'shimmer'

/** Semitone offsets added as extra spectral voices (excludes the 0 fundamental). */
export const INTERVAL_SETS: Record<IntervalSetId, readonly number[]> = {
  octaves: [12, -12, 24],
  fifths: [7, 19, -5],
  'fourths-fifths': [5, 7, 12],
  'major-triad': [4, 7, 12],
  'minor-triad': [3, 7, 12],
  cluster: [-2, 1, 2],
  shimmer: [12, 19, 24],
}

// ---------------------------------------------------------------------------
// Built-in generated sources
// ---------------------------------------------------------------------------

export type GeneratedSourceId =
  | 'harmonic-string'
  | 'breath-choir'
  | 'metallic-strike'
  | 'noise-reed'

export const GENERATED_SOURCE_IDS: readonly GeneratedSourceId[] = [
  'harmonic-string',
  'breath-choir',
  'metallic-strike',
  'noise-reed',
]

// ---------------------------------------------------------------------------
// Concrete DSP parameters consumed by the worklet
// ---------------------------------------------------------------------------

export interface SpectralParams {
  /** A↔B morph position, 0 = A, 1 = B. */
  morph: number
  /** Hold the current spectrum instead of tracking live input. */
  freeze: boolean
  freezePhase: PhaseMode
  /** Spectral energy shift in semitones (moves bins), distinct from note pitch. */
  shift: number
  /** Spectral-envelope (formant) shift in semitones, preserving played pitch. */
  formant: number
  /** Spectral blur across neighbouring bins, 0..1. */
  blur: number
  /** Energy tilt low↔high, -1..1 (negative = darker). */
  tilt: number
  /** Spectral gate threshold, 0..1 (relative to per-frame peak). */
  gate: number
  /** Number of extra harmonized spectral voices, 0..MAX_HARMONY_VOICES. */
  harmonyVoices: number
  harmonyInterval: IntervalSetId
  /** Wet level of harmonized voices, 0..1. */
  harmonyMix: number
  /** Phase drift amount for animated freeze, 0..1. */
  phaseMotion: number
  /** Amplitude envelope (seconds, except sustain which is a 0..1 level). */
  attack: number
  decay: number
  sustain: number
  release: number
  /** Musical transposition of the whole instrument in semitones, -24..24. */
  transpose: number
  /** Pitch-bend range in semitones, 0..24. */
  bendRange: number
  /** Stereo width 0..1. */
  stereoWidth: number
  /** Early-reflection amount 0..1. */
  earlyReflections: number
  /** Reverb tail amount 0..1. */
  reverbAmount: number
  /** Spectral diffusion in the space stage 0..1. */
  diffusion: number
  /** Input trim in dB, -24..24. */
  inputGainDb: number
  /** Output trim in dB, -24..24. */
  outputGainDb: number
}

// ---------------------------------------------------------------------------
// Macros & XY performance surface
// ---------------------------------------------------------------------------

export type MacroId = 'body' | 'motion' | 'harmony' | 'space'
export const MACRO_IDS: readonly MacroId[] = ['body', 'motion', 'harmony', 'space']

export type MacroValues = Record<MacroId, number>
export type MacroLinks = Record<MacroId, boolean>

export interface XYAxisMapping {
  param: keyof SpectralParams
  min: number
  max: number
}
export interface XYMapping {
  x: XYAxisMapping
  y: XYAxisMapping
}

export const DEFAULT_XY_MAPPING: XYMapping = {
  x: { param: 'shift', min: -12, max: 12 },
  y: { param: 'blur', min: 0, max: 1 },
}

// ---------------------------------------------------------------------------
// Patch — the full, persistable performance state
// ---------------------------------------------------------------------------

export interface SpectralPatch {
  schemaVersion: number
  presetId: string | null
  quality: QualityMode
  /** Deterministic seed for phase motion / randomized partial behaviour. */
  seed: number
  scale: ScaleId
  /** Bounded voice count, MIN_POLYPHONY..MAX_POLYPHONY. */
  polyphony: number
  /** Octave offset applied on top of transpose, -3..3. */
  octave: number
  /** Hand-edited baseline parameters (authoritative when a macro is unlinked). */
  params: SpectralParams
  macros: MacroValues
  macroLinks: MacroLinks
  /** Transient performance-surface position, persisted so a patch reopens identically. */
  xy: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// Spectral frame & snapshot
// ---------------------------------------------------------------------------

/** A single analysed STFT frame (one-sided spectrum). */
export interface SpectralFrame {
  fftSize: number
  /** fftSize/2 + 1. */
  binCount: number
  sampleRate: number
  /** Linear magnitude per bin. */
  magnitude: Float32Array
  /** Phase per bin in radians. */
  phase: Float32Array
}

export type SnapshotSlot = 'A' | 'B'

/** Capture a single instantaneous frame, or a short averaged region. */
export type CaptureMode = 'frame' | 'average'

/**
 * A captured spectral identity. Holds derived spectral data only — never the
 * source waveform. `isLiveDerived` is true when captured from microphone/tab
 * audio, which gates embedded-snapshot sharing behind explicit consent.
 */
export interface SpectralSnapshot {
  schemaVersion: number
  fftSize: number
  binCount: number
  analysisSampleRate: number
  /** Estimated fundamental in Hz for pitch mapping, or 0 when unpitched. */
  baseFrequency: number
  magnitude: Float32Array
  phase: Float32Array | null
  sourceLabel: string
  /** Epoch ms; supplied by the caller so tests stay deterministic. */
  capturedAt: number
  isLiveDerived: boolean
}

/**
 * Wire form of a snapshot for persistence and sharing: magnitudes quantized to
 * dB bytes, optional phase quantized over [-π, π]. The codec lives in
 * sharing/snapshotCodec.ts; this is only the shape.
 */
export interface SerializedSnapshot {
  v: number
  fftSize: number
  sr: number
  f0: number
  /** Base64 of a Uint8Array, one byte per bin, quantized over [magFloorDb, 0]. */
  mag: string
  magFloorDb: number
  /** Base64 of a Uint8Array of phase, present only when phase was stored. */
  phase?: string
  label: string
  at: number
  live: boolean
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

export interface Preset {
  id: string
  name: string
  hint: string
  group: string
  source: GeneratedSourceId
  patch: SpectralPatch
  xyMapping: XYMapping
  captureStrategy: CaptureMode
  /** Output gain trim (dB) applied for loudness normalisation across presets. */
  calibrationDb: number
}

// ---------------------------------------------------------------------------
// Worklet <-> main message protocol
// ---------------------------------------------------------------------------

/** Commands sent from the main thread to the worklet. */
export type EngineCommand =
  | { type: 'set-params'; params: SpectralParams }
  | { type: 'set-quality'; quality: QualityMode }
  | { type: 'set-seed'; seed: number }
  | { type: 'set-polyphony'; value: number }
  | { type: 'capture'; slot: SnapshotSlot; mode: CaptureMode }
  | { type: 'load-snapshot'; slot: SnapshotSlot; snapshot: SpectralSnapshot }
  | { type: 'clear-snapshot'; slot: SnapshotSlot }
  | { type: 'swap-snapshots' }
  | { type: 'copy-snapshot'; from: SnapshotSlot; to: SnapshotSlot }
  | { type: 'freeze-live'; on: boolean }
  | { type: 'clear-live' }
  | { type: 'note-on'; note: number; velocity: number }
  | { type: 'note-off'; note: number }
  | { type: 'pitch-bend'; semitones: number }
  | { type: 'sustain'; on: boolean }
  | { type: 'panic' }
  | { type: 'set-monitor'; on: boolean }
  | { type: 'audition'; slot: SnapshotSlot | null }
  | { type: 'reset' }

/** Events sent from the worklet back to the main thread. */
export type EngineEvent =
  | { type: 'ready' }
  | { type: 'telemetry'; telemetry: EngineTelemetry }
  | { type: 'snapshot-captured'; slot: SnapshotSlot; snapshot: SpectralSnapshot }
  | { type: 'overload'; active: boolean }

/** Throttled (~display-fps) status pushed from the worklet to the UI. */
export interface EngineTelemetry {
  /** Current display spectrum, dB, length DISPLAY_BINS. */
  spectrum: Float32Array
  /** Frozen/snapshot overlay spectrum (dB, DISPLAY_BINS) or null. */
  frozen: Float32Array | null
  activeVoices: number
  /** Pre-limiter peak, linear. */
  peak: number
  /** Limiter gain reduction in dB (>= 0). */
  limiterGainReductionDb: number
  clip: boolean
  frozenLive: boolean
  liveBufferSeconds: number
  /** Estimated worklet CPU load, 0..1. */
  cpuLoad: number
}

// ---------------------------------------------------------------------------
// Saved instrument (top-level persistence unit)
// ---------------------------------------------------------------------------

export interface SavedInstrument {
  schemaVersion: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  patch: SpectralPatch
  /** Snapshots are stored separately (IndexedDB) and referenced by id. */
  snapshotRefA: string | null
  snapshotRefB: string | null
  sourceLabel: string
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Coerce to a finite number within [min,max], falling back to `fallback`. */
export function finiteClamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

function finiteInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(finiteClamp(value, min, max, fallback))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMS: SpectralParams = {
  morph: 0,
  freeze: false,
  freezePhase: 'animate',
  shift: 0,
  formant: 0,
  blur: 0,
  tilt: 0,
  gate: 0,
  harmonyVoices: 0,
  harmonyInterval: 'octaves',
  harmonyMix: 0.5,
  phaseMotion: 0.2,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.8,
  release: 0.4,
  transpose: 0,
  bendRange: 2,
  stereoWidth: 0.5,
  earlyReflections: 0.2,
  reverbAmount: 0.25,
  diffusion: 0.3,
  inputGainDb: 0,
  outputGainDb: 0,
}

export const DEFAULT_MACROS: MacroValues = { body: 0.5, motion: 0.3, harmony: 0, space: 0.3 }
export const DEFAULT_MACRO_LINKS: MacroLinks = { body: true, motion: true, harmony: true, space: true }

export const DEFAULT_PATCH: SpectralPatch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  presetId: null,
  quality: 'normal',
  seed: 0x1234,
  scale: 'chromatic',
  polyphony: 6,
  octave: 0,
  params: DEFAULT_PARAMS,
  macros: DEFAULT_MACROS,
  macroLinks: DEFAULT_MACRO_LINKS,
  xy: { x: 0.5, y: 0 },
}

// ---------------------------------------------------------------------------
// Sanitizers — the boundary against malformed persisted / shared / wire data.
// ---------------------------------------------------------------------------

const PHASE_MODES: readonly PhaseMode[] = ['lock', 'animate']
const SCALE_IDS: readonly ScaleId[] = ['chromatic', 'major', 'minor', 'pentatonic', 'dorian', 'mixolydian']
const INTERVAL_SET_IDS = Object.keys(INTERVAL_SETS) as IntervalSetId[]
const QUALITY_MODES: readonly QualityMode[] = ['eco', 'normal', 'high']
const MACRO_ID_LIST = MACRO_IDS

export function sanitizeParams(raw: unknown): SpectralParams {
  const p = (raw ?? {}) as Partial<SpectralParams>
  return {
    morph: finiteClamp(p.morph, 0, 1, DEFAULT_PARAMS.morph),
    freeze: Boolean(p.freeze),
    freezePhase: oneOf(p.freezePhase, PHASE_MODES, DEFAULT_PARAMS.freezePhase),
    shift: finiteClamp(p.shift, -24, 24, DEFAULT_PARAMS.shift),
    formant: finiteClamp(p.formant, -24, 24, DEFAULT_PARAMS.formant),
    blur: finiteClamp(p.blur, 0, 1, DEFAULT_PARAMS.blur),
    tilt: finiteClamp(p.tilt, -1, 1, DEFAULT_PARAMS.tilt),
    gate: finiteClamp(p.gate, 0, 1, DEFAULT_PARAMS.gate),
    harmonyVoices: finiteInt(p.harmonyVoices, 0, MAX_HARMONY_VOICES, DEFAULT_PARAMS.harmonyVoices),
    harmonyInterval: oneOf(p.harmonyInterval, INTERVAL_SET_IDS, DEFAULT_PARAMS.harmonyInterval),
    harmonyMix: finiteClamp(p.harmonyMix, 0, 1, DEFAULT_PARAMS.harmonyMix),
    phaseMotion: finiteClamp(p.phaseMotion, 0, 1, DEFAULT_PARAMS.phaseMotion),
    attack: finiteClamp(p.attack, 0, 10, DEFAULT_PARAMS.attack),
    decay: finiteClamp(p.decay, 0, 10, DEFAULT_PARAMS.decay),
    sustain: finiteClamp(p.sustain, 0, 1, DEFAULT_PARAMS.sustain),
    release: finiteClamp(p.release, 0.001, 20, DEFAULT_PARAMS.release),
    transpose: finiteClamp(p.transpose, -24, 24, DEFAULT_PARAMS.transpose),
    bendRange: finiteClamp(p.bendRange, 0, 24, DEFAULT_PARAMS.bendRange),
    stereoWidth: finiteClamp(p.stereoWidth, 0, 1, DEFAULT_PARAMS.stereoWidth),
    earlyReflections: finiteClamp(p.earlyReflections, 0, 1, DEFAULT_PARAMS.earlyReflections),
    reverbAmount: finiteClamp(p.reverbAmount, 0, 1, DEFAULT_PARAMS.reverbAmount),
    diffusion: finiteClamp(p.diffusion, 0, 1, DEFAULT_PARAMS.diffusion),
    inputGainDb: finiteClamp(p.inputGainDb, -24, 24, DEFAULT_PARAMS.inputGainDb),
    outputGainDb: finiteClamp(p.outputGainDb, -24, 24, DEFAULT_PARAMS.outputGainDb),
  }
}

function sanitizeMacros(raw: unknown): MacroValues {
  const m = (raw ?? {}) as Partial<MacroValues>
  const out = {} as MacroValues
  for (const id of MACRO_ID_LIST) out[id] = finiteClamp(m[id], 0, 1, DEFAULT_MACROS[id])
  return out
}

function sanitizeMacroLinks(raw: unknown): MacroLinks {
  const m = (raw ?? {}) as Partial<MacroLinks>
  const out = {} as MacroLinks
  for (const id of MACRO_ID_LIST) out[id] = m[id] === undefined ? DEFAULT_MACRO_LINKS[id] : Boolean(m[id])
  return out
}

export function sanitizePatch(raw: unknown): SpectralPatch {
  const p = (raw ?? {}) as Partial<SpectralPatch>
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    presetId: typeof p.presetId === 'string' ? p.presetId : null,
    quality: oneOf(p.quality, QUALITY_MODES, DEFAULT_PATCH.quality),
    seed: finiteInt(p.seed, 0, 0xffffffff, DEFAULT_PATCH.seed),
    scale: oneOf(p.scale, SCALE_IDS, DEFAULT_PATCH.scale),
    polyphony: finiteInt(p.polyphony, MIN_POLYPHONY, MAX_POLYPHONY, DEFAULT_PATCH.polyphony),
    octave: finiteInt(p.octave, -3, 3, DEFAULT_PATCH.octave),
    params: sanitizeParams(p.params),
    macros: sanitizeMacros(p.macros),
    macroLinks: sanitizeMacroLinks(p.macroLinks),
    xy: {
      x: finiteClamp((p.xy as { x?: number } | undefined)?.x, 0, 1, DEFAULT_PATCH.xy.x),
      y: finiteClamp((p.xy as { y?: number } | undefined)?.y, 0, 1, DEFAULT_PATCH.xy.y),
    },
  }
}

/** dB → linear amplitude. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** linear amplitude → dB, floored to avoid -Infinity. */
export function gainToDb(gain: number, floorDb = -120): number {
  if (gain <= 0) return floorDb
  return Math.max(floorDb, 20 * Math.log10(gain))
}

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}
