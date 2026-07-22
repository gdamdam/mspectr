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
  sanitizeParams,
  sanitizeSnapshot,
} from '../contracts'
import { SpectralEngine } from '../SpectralEngine'
import { LoadMeter } from '../loadMeter'

// Monotonic wall clock for render-cost measurement. `performance.now` is present
// in AudioWorkletGlobalScope on some engines and gives finer resolution; Date is
// always available as a fallback. Both return milliseconds. This is used only
// for the load estimate — never for DSP, which stays fully deterministic.
const nowMs: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now()

class SpectralProcessor extends AudioWorkletProcessor {
  private engine: SpectralEngine
  private monoIn = new Float32Array(128)
  private displayFps = 30
  private telemetryInterval: number
  private blockCounter = 0
  private spectrum = new Float32Array(DISPLAY_BINS)
  private frozen = new Float32Array(DISPLAY_BINS)
  // --- render-load measurement (see updateLoad) ---
  /** Summed render() wall time (ms) over the current telemetry window. */
  private renderTimeAccum = 0
  /** Summed frames rendered over the current telemetry window. */
  private renderFramesAccum = 0
  /** Smoothing + hysteresis for the measured load; transitions post events. */
  private loadMeter = new LoadMeter()

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
    // Reject structurally malformed messages before touching the engine.
    if (!cmd || typeof (cmd as { type?: unknown }).type !== 'string') return
    switch (cmd.type) {
      case 'set-params':
        // Re-run the boundary sanitizer even though the main thread already does:
        // a raw postMessage must never reach the DSP loop with an out-of-range or
        // non-finite parameter. sanitizeParams is the single source of bounds.
        this.engine.setParams(sanitizeParams(cmd.params))
        break
      case 'set-quality':
        this.engine.setQuality(cmd.quality)
        this.displayFps = qualityConfig(cmd.quality).displayFps
        this.telemetryInterval = Math.max(1, Math.round(sampleRate / (128 * this.displayFps)))
        break
      case 'set-seed':
        this.engine.setSeed(cmd.seed)
        break
      case 'set-tempo':
        this.engine.setTempo(cmd.bpm)
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
      case 'load-snapshot': {
        // Validate bounds/lengths before the engine indexes or resamples it;
        // a malformed snapshot is ignored rather than allowed to misindex.
        const snap = sanitizeSnapshot(cmd.snapshot)
        if (snap) this.engine.loadSnapshot(cmd.slot, snap)
        break
      }
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

    // Measure the wall time the DSP takes against this quantum's real-time
    // budget. A single 128-frame render is too fast for a coarse clock, so the
    // cost is accumulated across the telemetry window and divided by that
    // window's total budget in postTelemetry — a defensible measured proxy for
    // scheduling pressure, not voice count. Two clock reads per quantum only.
    const t0 = nowMs()
    this.engine.render(monoIn, outL, outR)
    this.renderTimeAccum += nowMs() - t0
    this.renderFramesAccum += len

    // Throttled telemetry.
    if (++this.blockCounter >= this.telemetryInterval) {
      this.blockCounter = 0
      this.postTelemetry()
    }
    return true
  }

  /**
   * Fold the window's accumulated render time into the smoothed load estimate
   * and emit an overload event only when the latched state flips. `load` is the
   * fraction of real time the DSP consumed: renderMs / (frames/sampleRate * 1000).
   */
  private updateLoad(): void {
    const changed = this.loadMeter.update(this.renderTimeAccum, this.renderFramesAccum, sampleRate)
    this.renderTimeAccum = 0
    this.renderFramesAccum = 0
    if (changed) {
      const evt: EngineEvent = { type: 'overload', active: this.loadMeter.isOverloaded }
      this.port.postMessage(evt)
    }
  }

  private postTelemetry(): void {
    const e = this.engine
    this.updateLoad()
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
      // Measured render cost (see updateLoad), clamped to the reported 0..1
      // range — this is real scheduling pressure, not activeVoices/maxVoices.
      cpuLoad: Math.min(1, this.loadMeter.value),
    }
    const evt: EngineEvent = { type: 'telemetry', telemetry }
    const transfer: ArrayBuffer[] = [telemetry.spectrum.buffer as ArrayBuffer]
    if (telemetry.frozen) transfer.push(telemetry.frozen.buffer as ArrayBuffer)
    this.port.postMessage(evt, transfer)
  }
}

registerProcessor('spectral-processor', SpectralProcessor)
