/**
 * AudioWorkletProcessor adapter around SpectralEngine. It owns no DSP itself —
 * it translates port messages (EngineCommand) into engine calls, pumps audio in
 * `process`, and posts throttled telemetry + captured snapshots back to the main
 * thread. All audio-rate work lives in the engine; this file never allocates in
 * the steady-state audio path beyond the throttled telemetry buffers.
 */
import {
  type EngineCommand,
  type EngineEvent,
  type EngineTelemetry,
  type SnapshotSlot,
  DISPLAY_BINS,
  qualityConfig,
} from '../contracts'
import { SpectralEngine } from '../SpectralEngine'

class SpectralProcessor extends AudioWorkletProcessor {
  private engine: SpectralEngine
  private monoIn = new Float32Array(128)
  private displayFps = 30
  private telemetryInterval: number
  private blockCounter = 0
  private spectrum = new Float32Array(DISPLAY_BINS)
  private frozen = new Float32Array(DISPLAY_BINS)

  constructor() {
    super()
    this.engine = new SpectralEngine(sampleRate, 'normal')
    this.engine.setOnCaptured((slot: SnapshotSlot, snapshot) => {
      const evt: EngineEvent = { type: 'snapshot-captured', slot, snapshot }
      // Transfer the snapshot's typed-array buffers to avoid a copy.
      const transfer: ArrayBuffer[] = [snapshot.magnitude.buffer as ArrayBuffer]
      if (snapshot.phase) transfer.push(snapshot.phase.buffer as ArrayBuffer)
      this.port.postMessage(evt, transfer)
    })
    this.telemetryInterval = Math.max(1, Math.round(sampleRate / (128 * this.displayFps)))
    this.port.onmessage = (e: MessageEvent<EngineCommand>) => this.handle(e.data)
    const ready: EngineEvent = { type: 'ready' }
    this.port.postMessage(ready)
  }

  private handle(cmd: EngineCommand): void {
    switch (cmd.type) {
      case 'set-params':
        this.engine.setParams(cmd.params)
        break
      case 'set-quality':
        this.engine.setQuality(cmd.quality)
        this.displayFps = qualityConfig(cmd.quality).displayFps
        this.telemetryInterval = Math.max(1, Math.round(sampleRate / (128 * this.displayFps)))
        break
      case 'set-seed':
        this.engine.setSeed(cmd.seed)
        break
      case 'set-polyphony':
        this.engine.setPolyphony(cmd.value)
        break
      case 'capture':
        this.engine.capture(
          cmd.slot,
          cmd.mode,
          cmd.sourceLabel,
          cmd.isLiveDerived,
          cmd.capturedAt,
        )
        break
      case 'load-snapshot':
        this.engine.loadSnapshot(cmd.slot, cmd.snapshot)
        break
      case 'clear-snapshot':
        this.engine.clearSnapshot(cmd.slot)
        break
      case 'swap-snapshots':
        this.engine.swapSnapshots()
        break
      case 'copy-snapshot':
        this.engine.copySnapshot(cmd.from, cmd.to)
        break
      case 'freeze-live':
        this.engine.freezeLive(cmd.on)
        break
      case 'clear-live':
        this.engine.clearLive()
        break
      case 'note-on':
        this.engine.noteOn(cmd.note, cmd.velocity)
        break
      case 'note-off':
        this.engine.noteOff(cmd.note)
        break
      case 'pitch-bend':
        this.engine.pitchBend(cmd.semitones)
        break
      case 'sustain':
        this.engine.sustain(cmd.on)
        break
      case 'panic':
        this.engine.panic()
        break
      case 'set-monitor':
        this.engine.setMonitor(cmd.on)
        break
      case 'audition':
        this.engine.audition(cmd.slot)
        break
      case 'reset':
        this.engine.reset()
        break
      default:
        break
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (!output || output.length === 0) return true
    const outL = output[0]
    const outR = output.length > 1 ? output[1] : output[0]
    const len = outL.length
    if (this.monoIn.length !== len) this.monoIn = new Float32Array(len)
    const monoIn = this.monoIn

    const input = inputs[0]
    if (input && input.length > 0) {
      if (input.length === 1) {
        monoIn.set(input[0])
      } else {
        const a = input[0]
        const b = input[1]
        for (let i = 0; i < len; i++) monoIn[i] = 0.5 * (a[i] + b[i])
      }
    } else {
      monoIn.fill(0)
    }

    this.engine.render(monoIn, outL, outR)

    // Throttled telemetry.
    if (++this.blockCounter >= this.telemetryInterval) {
      this.blockCounter = 0
      this.postTelemetry()
    }
    return true
  }

  private postTelemetry(): void {
    const e = this.engine
    e.fillDisplaySpectrum(this.spectrum, 'live')
    const hasSnapshot = e.snapshotFilled('A') || e.snapshotFilled('B')
    let frozenOut: Float32Array | null = null
    if (hasSnapshot) {
      e.fillDisplaySpectrum(this.frozen, 'morph')
      frozenOut = this.frozen.slice()
    }
    const peak = e.instrumentPeak
    const telemetry: EngineTelemetry = {
      spectrum: this.spectrum.slice(),
      frozen: frozenOut,
      activeVoices: e.activeVoices(),
      peak,
      limiterGainReductionDb: e.limiterGainReductionDb,
      clip: peak >= 0.999,
      frozenLive: e.isFrozenLive(),
      liveBufferSeconds: e.liveBufferSeconds(),
      cpuLoad: Math.min(1, e.activeVoices() / 8),
    }
    const evt: EngineEvent = { type: 'telemetry', telemetry }
    const transfer: ArrayBuffer[] = [telemetry.spectrum.buffer as ArrayBuffer]
    if (telemetry.frozen) transfer.push(telemetry.frozen.buffer as ArrayBuffer)
    this.port.postMessage(evt, transfer)
  }
}

registerProcessor('spectral-processor', SpectralProcessor)
