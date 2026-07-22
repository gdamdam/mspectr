/**
 * AudioEngine — the main-thread adapter implementing AudioEngineApi.
 *
 * Graph:
 *   source ─┬─▶ spectral worklet ─▶ instrumentGain ─┐
 *           └─▶ monitorGain ───────────────────────┴─▶ finalLimiter ─▶ destination
 *
 * The worklet performs analysis + instrument synthesis (it self-limits the
 * instrument bus). `monitorGain` is muted by default — only generated sources
 * opt into monitoring; live mic/tab input stays silent to prevent feedback. A
 * DynamicsCompressor brickwall protects the summed output and is the recorder's
 * tap point. Context suspension (tab hidden, iOS interruptions) auto-recovers.
 */
import {
  type CaptureMode,
  type EngineCommand,
  type EngineEvent,
  type QualityMode,
  type SnapshotSlot,
  type SpectralParams,
  type SpectralSnapshot,
  LIMITER_CEILING_DB,
  dbToGain,
  finiteClamp,
} from './contracts'
import type {
  AudioEngineApi,
  OverloadListener,
  SnapshotCapturedListener,
  TelemetryListener,
} from './engineApi'
import spectralWorkletUrl from './worklets/spectral.worklet.ts?worker&url'

export class AudioEngine implements AudioEngineApi {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private monitorGain: GainNode | null = null
  private instrumentGain: GainNode | null = null
  private finalLimiter: DynamicsCompressorNode | null = null
  private sourceNode: AudioNode | null = null

  private telemetryListeners = new Set<TelemetryListener>()
  private snapshotListeners = new Set<SnapshotCapturedListener>()
  private overloadListeners = new Set<OverloadListener>()

  private starting: Promise<void> | null = null
  private disposed = false
  private pendingQuality: QualityMode = 'normal'
  /**
   * Per-preset loudness-normalisation trim (dB) applied on the instrument bus,
   * kept SEPARATE from the patch's `outputGainDb` (user output trim, applied
   * inside the worklet) so the two never double-count. Survives worklet
   * recreation because it is reapplied to instrumentGain in boot().
   */
  private calibrationDb = 0

  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.tryResume()
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  get running(): boolean {
    return this.ctx?.state === 'running' && this.node !== null
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('AudioEngine disposed')
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = this.boot()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async boot(): Promise<void> {
    const ctx =
      this.ctx ??
      new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()

    if (!this.node) {
      await ctx.audioWorklet.addModule(spectralWorkletUrl)
      const node = new AudioWorkletNode(ctx, 'spectral-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })
      node.port.onmessage = (e: MessageEvent<EngineEvent>) => this.onEvent(e.data)

      const instrumentGain = ctx.createGain()
      const monitorGain = ctx.createGain()
      monitorGain.gain.value = 0 // muted by default (feedback safety)
      const finalLimiter = ctx.createDynamicsCompressor()
      finalLimiter.threshold.value = LIMITER_CEILING_DB
      finalLimiter.knee.value = 0
      finalLimiter.ratio.value = 20
      finalLimiter.attack.value = 0.003
      finalLimiter.release.value = 0.12

      instrumentGain.gain.value = dbToGain(this.calibrationDb)
      node.connect(instrumentGain).connect(finalLimiter)
      monitorGain.connect(finalLimiter)
      finalLimiter.connect(ctx.destination)

      this.node = node
      this.instrumentGain = instrumentGain
      this.monitorGain = monitorGain
      this.finalLimiter = finalLimiter

      if (this.sourceNode) this.wireSource(this.sourceNode)
      this.post({ type: 'set-quality', quality: this.pendingQuality })
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
      window.addEventListener('pageshow', this.onVisibility)
    }
  }

  private async tryResume(): Promise<void> {
    try {
      if (this.ctx && this.ctx.state !== 'running' && !this.disposed) await this.ctx.resume()
    } catch {
      /* best-effort */
    }
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
      window.removeEventListener('pageshow', this.onVisibility)
    }
    try {
      this.post({ type: 'panic' })
    } catch {
      /* node may be gone */
    }
    this.node?.disconnect()
    this.instrumentGain?.disconnect()
    this.monitorGain?.disconnect()
    this.finalLimiter?.disconnect()
    this.node = null
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close()
      } catch {
        /* ignore */
      }
    }
    this.ctx = null
    this.telemetryListeners.clear()
    this.snapshotListeners.clear()
    this.overloadListeners.clear()
  }

  setSourceNode(node: AudioNode | null): void {
    if (this.sourceNode && this.node) {
      try {
        this.sourceNode.disconnect(this.node)
      } catch {
        /* not connected */
      }
      if (this.monitorGain) {
        try {
          this.sourceNode.disconnect(this.monitorGain)
        } catch {
          /* not connected */
        }
      }
    }
    this.sourceNode = node
    if (node) this.wireSource(node)
  }

  private wireSource(node: AudioNode): void {
    if (this.node) node.connect(this.node)
    if (this.monitorGain) node.connect(this.monitorGain)
  }

  setParams(params: SpectralParams): void {
    this.post({ type: 'set-params', params })
  }

  setQuality(quality: QualityMode): void {
    this.pendingQuality = quality
    this.post({ type: 'set-quality', quality })
  }

  setSeed(seed: number): void {
    this.post({ type: 'set-seed', seed })
  }

  setTempo(bpm: number): void {
    this.post({ type: 'set-tempo', bpm })
  }

  setPolyphony(value: number): void {
    this.post({ type: 'set-polyphony', value })
  }

  capture(
    slot: SnapshotSlot,
    mode: CaptureMode,
    metadata = { sourceLabel: '', capturedAt: 0, isLiveDerived: false },
  ): void {
    this.post({ type: 'capture', slot, mode, ...metadata })
  }

  loadSnapshot(slot: SnapshotSlot, snapshot: SpectralSnapshot): void {
    this.post({ type: 'load-snapshot', slot, snapshot })
  }

  clearSnapshot(slot: SnapshotSlot): void {
    this.post({ type: 'clear-snapshot', slot })
  }

  swapSnapshots(): void {
    this.post({ type: 'swap-snapshots' })
  }

  copySnapshot(from: SnapshotSlot, to: SnapshotSlot): void {
    this.post({ type: 'copy-snapshot', from, to })
  }

  freezeLive(on: boolean): void {
    this.post({ type: 'freeze-live', on })
  }

  clearLive(): void {
    this.post({ type: 'clear-live' })
  }

  noteOn(note: number, velocity: number): void {
    this.post({ type: 'note-on', note, velocity })
  }

  noteOff(note: number): void {
    this.post({ type: 'note-off', note })
  }

  pitchBend(semitones: number): void {
    this.post({ type: 'pitch-bend', semitones })
  }

  sustain(on: boolean): void {
    this.post({ type: 'sustain', on })
  }

  panic(): void {
    this.post({ type: 'panic' })
  }

  setMonitor(on: boolean): void {
    if (!this.monitorGain || !this.ctx) return
    const target = on ? dbToGain(-3) : 0
    this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02)
  }

  setCalibration(db: number): void {
    // Preset loudness trim on the instrument bus. Clamped to the same range as
    // the patch's output trim; smoothed so a preset change never clicks.
    this.calibrationDb = finiteClamp(db, -24, 24, 0)
    if (this.instrumentGain && this.ctx) {
      this.instrumentGain.gain.setTargetAtTime(dbToGain(this.calibrationDb), this.ctx.currentTime, 0.02)
    }
  }

  audition(slot: SnapshotSlot | null): void {
    this.post({ type: 'audition', slot })
  }

  getOutputNode(): AudioNode | null {
    return this.finalLimiter
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener)
    return () => this.telemetryListeners.delete(listener)
  }

  onSnapshotCaptured(listener: SnapshotCapturedListener): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  onOverload(listener: OverloadListener): () => void {
    this.overloadListeners.add(listener)
    return () => this.overloadListeners.delete(listener)
  }

  reset(): void {
    this.post({ type: 'reset' })
  }

  private post(cmd: EngineCommand): void {
    this.node?.port.postMessage(cmd)
  }

  private onEvent(evt: EngineEvent): void {
    switch (evt.type) {
      case 'telemetry':
        for (const l of this.telemetryListeners) l(evt.telemetry)
        break
      case 'snapshot-captured':
        for (const l of this.snapshotListeners) l(evt.slot, evt.snapshot)
        break
      case 'overload':
        for (const l of this.overloadListeners) l(evt.active)
        break
      case 'ready':
        break
      default:
        break
    }
  }
}
