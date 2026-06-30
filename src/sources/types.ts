/**
 * Source-adapter contracts. A source adapter turns one of the four input kinds
 * (built-in generated buffer, decoded file, microphone, tab audio) into a single
 * uniform {@link SourceHandle}: a started, connected AudioNode plus an optional
 * decimated waveform preview and a teardown hook. The engine only ever sees this
 * shape — it routes `handle.node` into `engine.setSourceNode` and calls
 * `handle.dispose()` when switching sources.
 *
 * Adapted from the mscope input-source abstraction
 * (mscope/src/audio/input/AudioInputSource.ts), collapsed from the stateful
 * subscribe/connect/start lifecycle into a flat "already live" handle because
 * mspectr acquires and connects in one step per source and has no UI state machine
 * around acquisition.
 */

/** The four input kinds mspectr can drive. All are local; nothing is uploaded. */
export type AudioInputKind = 'generated' | 'file' | 'microphone' | 'tab'

/**
 * A live, connected audio source ready to feed the engine. The contained `node`
 * is already started and (for buffer sources) looping; the caller routes it to
 * `engine.setSourceNode`. `waveformPreview` is purely secondary display info —
 * a decimated mono overview — and may be null for live streams where no buffer
 * exists. `dispose()` stops tracks / buffer sources and disconnects the node; it
 * is idempotent.
 */
export interface SourceHandle {
  id: string
  kind: AudioInputKind
  label: string
  /** Already started and connected; caller routes to engine.setSourceNode. */
  node: AudioNode
  /** Decimated mono preview, secondary info only; null when no buffer exists. */
  waveformPreview: Float32Array | null
  /** Stop tracks/sources and disconnect. Idempotent. */
  dispose(): void
}
