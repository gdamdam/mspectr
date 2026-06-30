/**
 * Master-output recorder AudioWorkletProcessor.
 *
 * Captures every render quantum it receives on input[0] and copies the
 * per-channel Float32 data back to the main thread via the port. The main
 * thread (wavRecorder.ts) assembles the chunks and encodes them with wav.ts.
 *
 * Why copy per quantum instead of buffering in the processor: the worklet has
 * no allocation budget and we want bounded memory governed on the main thread
 * (maxSeconds). Each `chunk` message carries a fresh copy because the render
 * buffers are reused by the audio thread after `process` returns.
 *
 * No Date.now / Math.random — purely sample-driven; the main thread owns timing.
 *
 * Adapted in spirit from mloop's recorder-worklet, generalised here to forward
 * an arbitrary channel count (stereo master tap) rather than mono mic input.
 */

// AudioWorkletGlobalScope globals (`sampleRate`, `AudioWorkletProcessor`,
// `registerProcessor`) are declared once, project-wide, in
// src/audio/worklets/audioworklet.d.ts. This file compiles in the worklet scope.

interface AudioWorkletProcessorLike {
  readonly port: MessagePort
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean
}

class RecorderProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorLike {
  private recording = false

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
        this.port.postMessage({ type: 'stopped' })
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (this.recording && input && input.length > 0 && input[0] && input[0].length > 0) {
      // Copy each channel; the underlying buffers are recycled after we return.
      const channels: Float32Array[] = new Array(input.length)
      for (let c = 0; c < input.length; c++) {
        const src = input[c]
        const copy = new Float32Array(src.length)
        copy.set(src)
        channels[c] = copy
      }
      this.port.postMessage({ type: 'chunk', channels }, channels.map((c) => c.buffer))
    }
    return true // keep processor alive until the node is disconnected
  }
}

registerProcessor('mspectr-recorder', RecorderProcessor)
