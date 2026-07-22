/**
 * Master-output recorder AudioWorkletProcessor.
 *
 * Copies the per-channel Float32 data it receives on input[0] back to the main
 * thread via the port. The main thread (wavRecorder.ts) assembles the chunks
 * and encodes them with wav.ts.
 *
 * Batching: rather than post one message per render quantum (~344 msgs/s @44.1k,
 * one allocation+transfer each), we accumulate quanta into a pre-allocated batch
 * buffer per channel (allocated once, on the first quantum) and post only when it
 * fills — ~21 msgs/s at BATCH_FRAMES=2048 — flushing the partial tail on stop.
 * This keeps message traffic and per-quantum allocation low without dropping
 * audio; bounded memory is still governed on the main thread (maxSeconds). Only
 * the flush copy allocates, so the steady-state per-quantum path is allocation
 * free apart from filling the reused batch buffer.
 *
 * No Date.now / Math.random — purely sample-driven; the main thread owns timing.
 *
 * Adapted in spirit from mloop's recorder-worklet, generalised here to forward
 * an arbitrary channel count (stereo master tap) rather than mono mic input.
 */

/** Frames accumulated before a batch is posted (multiple of the 128 quantum). */
const BATCH_FRAMES = 2048

// AudioWorkletGlobalScope globals (`sampleRate`, `AudioWorkletProcessor`,
// `registerProcessor`) are declared once, project-wide, in
// src/audio/worklets/audioworklet.d.ts. This file compiles in the worklet scope.

interface AudioWorkletProcessorLike {
  readonly port: MessagePort
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean
}

class RecorderProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorLike {
  private recording = false
  /** Per-channel accumulator, allocated once on the first quantum. */
  private batch: Float32Array[] | null = null
  private numChannels = 0
  /** Frames currently held in the batch buffers. */
  private fill = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      const type = (e.data as { type?: string })?.type
      if (type === 'start') {
        this.recording = true
        // Report the audio-thread sample rate so the encoder is authoritative.
        this.port.postMessage({ type: 'meta', sampleRate })
      } else if (type === 'stop') {
        this.recording = false
        // Deliver the partial tail before signalling stop so no audio is lost.
        this.flush()
        this.port.postMessage({ type: 'stopped' })
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (this.recording && input && input.length > 0 && input[0] && input[0].length > 0) {
      // Allocate the batch buffers once, on the first quantum, when the channel
      // count is known. Steady-state processing only fills these reused buffers.
      if (this.batch === null) {
        this.numChannels = input.length
        this.batch = new Array(this.numChannels)
        for (let c = 0; c < this.numChannels; c++) this.batch[c] = new Float32Array(BATCH_FRAMES)
        this.fill = 0
      }
      const len = input[0].length
      let read = 0
      while (read < len) {
        const take = Math.min(BATCH_FRAMES - this.fill, len - read)
        for (let c = 0; c < this.numChannels; c++) {
          const src = input[c] ?? input[0]
          this.batch[c].set(src.subarray(read, read + take), this.fill)
        }
        this.fill += take
        read += take
        if (this.fill >= BATCH_FRAMES) this.flush()
      }
    }
    return true // keep processor alive until the node is disconnected
  }

  /** Post the accumulated frames as one transferable chunk and reset the fill. */
  private flush(): void {
    if (this.batch === null || this.fill === 0) return
    const channels: Float32Array[] = new Array(this.numChannels)
    for (let c = 0; c < this.numChannels; c++) {
      const out = new Float32Array(this.fill)
      out.set(this.batch[c].subarray(0, this.fill))
      channels[c] = out
    }
    this.port.postMessage({ type: 'chunk', channels }, channels.map((c) => c.buffer))
    this.fill = 0
  }
}

registerProcessor('mspectr-recorder', RecorderProcessor)
