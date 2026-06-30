/**
 * The public face of the audio engine. The UI, sources, recording, and
 * persistence layers depend only on this interface — never on the concrete
 * AudioEngine or the worklet — so they can be built and tested independently of
 * the DSP implementation. AudioEngine (audio/AudioEngine.ts) implements it.
 */
import type {
  CaptureMode,
  EngineTelemetry,
  QualityMode,
  SnapshotSlot,
  SpectralParams,
  SpectralSnapshot,
} from './contracts'

export type TelemetryListener = (telemetry: EngineTelemetry) => void
export type SnapshotCapturedListener = (slot: SnapshotSlot, snapshot: SpectralSnapshot) => void
export type OverloadListener = (active: boolean) => void

export interface AudioEngineApi {
  /** The underlying AudioContext (created lazily on start). Null before start. */
  readonly context: AudioContext | null
  /** True once the worklet is loaded and the context is running. */
  readonly running: boolean

  /** Create/resume the AudioContext and load the worklet. Idempotent. */
  start(): Promise<void>
  /** Suspend the context but keep state. */
  suspend(): Promise<void>
  /** Fully tear down: stop nodes, close context, drop listeners. */
  dispose(): Promise<void>

  /**
   * Route a source AudioNode (generated buffer, file, mic, tab) into the
   * analysis input. Passing null disconnects the current source. The engine
   * never assumes ownership of the node's lifecycle beyond connection.
   */
  setSourceNode(node: AudioNode | null): void

  setParams(params: SpectralParams): void
  setQuality(quality: QualityMode): void
  setSeed(seed: number): void
  /** Bounded voice count (1..MAX_POLYPHONY, further capped by quality mode). */
  setPolyphony(value: number): void

  capture(slot: SnapshotSlot, mode: CaptureMode): void
  loadSnapshot(slot: SnapshotSlot, snapshot: SpectralSnapshot): void
  clearSnapshot(slot: SnapshotSlot): void
  swapSnapshots(): void
  copySnapshot(from: SnapshotSlot, to: SnapshotSlot): void

  freezeLive(on: boolean): void
  clearLive(): void

  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  pitchBend(semitones: number): void
  sustain(on: boolean): void
  panic(): void

  /** Live input monitoring (passthrough to output). Muted by default. */
  setMonitor(on: boolean): void
  /** Audition a snapshot endpoint as a sustained tone, or null to stop. */
  audition(slot: SnapshotSlot | null): void

  /** Post-limiter output node — the correct tap point for the WAV recorder. */
  getOutputNode(): AudioNode | null

  onTelemetry(listener: TelemetryListener): () => void
  onSnapshotCaptured(listener: SnapshotCapturedListener): () => void
  onOverload(listener: OverloadListener): () => void

  reset(): void
}
