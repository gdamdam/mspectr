/**
 * WavRecorder — records the master (post-limiter) output to a WAV Blob.
 *
 * Tap = a post-limiter AudioNode supplied by the engine. We connect our capture
 * node to it without ever routing audio to the destination (the master is
 * already audible elsewhere), so recording is silent and side-effect free.
 *
 * Capture strategy
 * ----------------
 * Prefer an AudioWorkletNode ('mspectr-recorder', see recorder.worklet.ts):
 * sample-accurate, off the main thread. If the worklet module can't be
 * registered or the node can't be constructed (older Safari/Firefox quirks, or
 * a context whose worklet is unavailable), fall back to a ScriptProcessorNode —
 * deprecated but universally supported. This mirrors mloop's Recorder
 * (src/engine/Recorder.ts, AGPL-3.0, github.com/gdamdam/mloop): the stopping
 * guard, the worklet-drain safety timeout, and the cleanup discipline are
 * adapted from there. The bounded-buffer / maxSeconds cap and the elapsed timer
 * are new for mspectr.
 *
 * Bounded buffering: chunks accumulate in memory; at `maxSeconds` we
 * auto-stop, emit a final progress tick (so the UI can warn), and resolve the
 * pending stop()/finish. Nothing is left connected and no state is left stuck.
 *
 * No Date.now / Math.random in the capture path — elapsed time is derived from
 * captured sample counts, and the output filename takes an injected Date.
 */

import type { WavMetadata } from './wav'
import { encodeWavStereo } from './wav'
import { clamp, finiteClamp } from '../audio/contracts'
// Bundled as a separate worklet module (Vite emits a hashed asset URL), matching
// the spectral worklet. `new URL(..., import.meta.url)` on a .ts file inlines it
// into the main bundle instead, so addModule() would have nothing to load.
import recorderWorkletUrl from './recorder.worklet.ts?worker&url'

const WORKLET_NAME = 'mspectr-recorder'
const DEFAULT_MAX_SECONDS = 600
/** ScriptProcessor render block; 4096 keeps callback overhead modest. */
const SCRIPT_BLOCK = 4096
/** Safety timeout for the worklet to drain its final messages on stop. */
const WORKLET_STOP_TIMEOUT_MS = 3000

export interface RecorderOptions {
  bitDepth?: 16 | 24
  maxSeconds?: number
  meta?: WavMetadata
}

type ProgressCb = (seconds: number, approxBytes: number) => void

/** Module-level memo: once a context's worklet module is known-bad, skip it. */
let workletModuleReady = false
let workletModuleFailed = false

export class WavRecorder {
  private readonly ctx: AudioContext
  private readonly tap: AudioNode
  private readonly bitDepth: 16 | 24
  private readonly maxSeconds: number
  private readonly meta?: WavMetadata

  private workletNode: AudioWorkletNode | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private silentSink: GainNode | null = null

  private chunksL: Float32Array[] = []
  private chunksR: Float32Array[] = []
  private capturedFrames = 0
  private numChannels = 2
  private sampleRate: number

  private active = false
  /** Guards a second concurrent stop() from clobbering the pending resolve. */
  private stopping = false
  private maxFrames: number
  private progressCbs = new Set<ProgressCb>()
  private pagehideHandler: (() => void) | null = null

  constructor(ctx: AudioContext, tap: AudioNode, opts: RecorderOptions = {}) {
    this.ctx = ctx
    this.tap = tap
    this.bitDepth = opts.bitDepth === 24 ? 24 : 16
    this.maxSeconds = Math.max(1, finiteClamp(opts.maxSeconds, 1, 86_400, DEFAULT_MAX_SECONDS))
    this.meta = opts.meta
    this.sampleRate = ctx.sampleRate || 44_100
    this.maxFrames = Math.floor(this.maxSeconds * this.sampleRate)

    // Cancel any in-flight recording if the page is being torn down so we never
    // leak nodes or wedge the audio graph on navigation/bfcache.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.pagehideHandler = () => this.cancel()
      window.addEventListener('pagehide', this.pagehideHandler)
    }
  }

  get recording(): boolean {
    return this.active
  }

  /** Live timer derived from captured frames (no wall-clock dependency). */
  get elapsedSeconds(): number {
    return this.capturedFrames / this.sampleRate
  }

  onProgress(cb: ProgressCb): () => void {
    this.progressCbs.add(cb)
    return () => {
      this.progressCbs.delete(cb)
    }
  }

  async start(): Promise<void> {
    if (this.active) return
    this.resetBuffers()
    this.active = true
    this.stopping = false

    if (await this.tryStartWorklet()) return
    this.startScriptProcessor()
  }

  /** Stop, encode the captured audio, and resolve a WAV Blob. */
  stop(): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      if (this.stopping || !this.active) {
        // Redundant stop — return whatever has been captured (possibly empty).
        resolve(this.finishToBlob())
        return
      }
      this.stopping = true

      if (this.workletNode) {
        const node = this.workletNode
        const timeout = setTimeout(() => {
          this.teardownNodes()
          this.active = false
          this.stopping = false
          resolve(this.finishToBlob())
        }, WORKLET_STOP_TIMEOUT_MS)

        node.port.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string; channels?: Float32Array[] }
          if (data?.type === 'chunk' && data.channels) {
            this.pushChunk(data.channels)
          } else if (data?.type === 'stopped') {
            clearTimeout(timeout)
            this.teardownNodes()
            this.active = false
            this.stopping = false
            resolve(this.finishToBlob())
          }
        }
        node.port.postMessage({ type: 'stop' })
        return
      }

      // ScriptProcessor (or nothing) path: tear down synchronously.
      this.teardownNodes()
      this.active = false
      this.stopping = false
      resolve(this.finishToBlob())
    })
  }

  /** Abort without producing a Blob; discards captured audio and frees nodes. */
  cancel(): void {
    if (!this.active && !this.workletNode && !this.scriptNode) return
    this.teardownNodes()
    this.resetBuffers()
    this.active = false
    this.stopping = false
  }

  /** Release everything, including the pagehide listener. Idempotent. */
  dispose(): void {
    this.cancel()
    this.progressCbs.clear()
    if (this.pagehideHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pagehideHandler)
      this.pagehideHandler = null
    }
  }

  // -------------------------------------------------------------------------
  // Capture-node lifecycle
  // -------------------------------------------------------------------------

  private async tryStartWorklet(): Promise<boolean> {
    if (workletModuleFailed) return false
    const audioWorklet = this.ctx.audioWorklet as AudioWorklet | undefined
    if (!audioWorklet || typeof audioWorklet.addModule !== 'function') return false

    try {
      if (!workletModuleReady) {
        await audioWorklet.addModule(recorderWorkletUrl)
        workletModuleReady = true
      }
      const node = new AudioWorkletNode(this.ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      })
      node.port.onmessage = (e: MessageEvent) => {
        const data = e.data as { type?: string; channels?: Float32Array[]; sampleRate?: number }
        if (data?.type === 'chunk' && data.channels) {
          this.pushChunk(data.channels)
        } else if (data?.type === 'meta' && typeof data.sampleRate === 'number' && data.sampleRate > 0) {
          this.sampleRate = data.sampleRate
          this.maxFrames = Math.floor(this.maxSeconds * this.sampleRate)
        }
      }
      this.tap.connect(node)
      node.port.postMessage({ type: 'start' })
      this.workletNode = node
      return true
    } catch {
      // Module load or node construction failed — fall back permanently.
      workletModuleFailed = true
      this.workletNode = null
      return false
    }
  }

  private startScriptProcessor(): void {
    const node = this.ctx.createScriptProcessor(SCRIPT_BLOCK, 2, 2)
    node.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer
      const chCount = input.numberOfChannels
      const channels: Float32Array[] = []
      for (let c = 0; c < chCount; c++) {
        const src = input.getChannelData(c)
        const copy = new Float32Array(src.length)
        copy.set(src)
        channels.push(copy)
      }
      this.pushChunk(channels)
    }
    this.tap.connect(node)
    // A ScriptProcessor only runs while connected to the graph's destination;
    // route through a muted gain so we drive it without making any sound.
    const silent = this.ctx.createGain()
    silent.gain.value = 0
    node.connect(silent)
    silent.connect(this.ctx.destination)
    this.scriptNode = node
    this.silentSink = silent
  }

  private teardownNodes(): void {
    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null
        this.tap.disconnect(this.workletNode)
        this.workletNode.disconnect()
      } catch {
        /* already disconnected */
      }
      this.workletNode = null
    }
    if (this.scriptNode) {
      try {
        this.scriptNode.onaudioprocess = null
        this.tap.disconnect(this.scriptNode)
        this.scriptNode.disconnect()
      } catch {
        /* already disconnected */
      }
      this.scriptNode = null
    }
    if (this.silentSink) {
      try {
        this.silentSink.disconnect()
      } catch {
        /* already disconnected */
      }
      this.silentSink = null
    }
  }

  // -------------------------------------------------------------------------
  // Buffering
  // -------------------------------------------------------------------------

  private resetBuffers(): void {
    this.chunksL = []
    this.chunksR = []
    this.capturedFrames = 0
    this.numChannels = 2
  }

  private pushChunk(channels: Float32Array[]): void {
    if (!this.active || channels.length === 0) return

    const remaining = this.maxFrames - this.capturedFrames
    if (remaining <= 0) {
      this.autoStop()
      return
    }

    const incoming = channels[0].length
    const take = Math.min(incoming, remaining)
    this.numChannels = channels.length >= 2 ? 2 : 1

    const left = channels[0]
    const right = this.numChannels === 2 ? channels[1] : channels[0]

    if (take === incoming) {
      this.chunksL.push(left)
      if (this.numChannels === 2) this.chunksR.push(right)
    } else {
      // Final partial block to land exactly on maxFrames.
      this.chunksL.push(left.subarray(0, take))
      if (this.numChannels === 2) this.chunksR.push(right.subarray(0, take))
    }
    this.capturedFrames += take

    this.emitProgress()

    if (this.capturedFrames >= this.maxFrames) this.autoStop()
  }

  /**
   * Auto-stop when the cap is hit: detach capture, mark inactive, and notify a
   * final progress tick so the UI can surface the limit. If a stop() promise is
   * pending its message handler will still resolve from the buffered data.
   */
  private autoStop(): void {
    if (!this.active) return
    this.active = false
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' })
      } catch {
        /* port gone */
      }
    }
    // If no stop() is pending, detach immediately so nothing keeps running.
    if (!this.stopping) this.teardownNodes()
    this.emitProgress()
  }

  private emitProgress(): void {
    if (this.progressCbs.size === 0) return
    const bytesPerSample = this.bitDepth === 24 ? 3 : 2
    const approxBytes = 44 + this.capturedFrames * this.numChannels * bytesPerSample
    const seconds = this.capturedFrames / this.sampleRate
    for (const cb of this.progressCbs) cb(seconds, approxBytes)
  }

  private finishToBlob(): Blob {
    const channels = this.assembleChannels()
    const ab = encodeWavStereo(channels, this.sampleRate, this.bitDepth, this.meta)
    this.resetBuffers()
    return new Blob([ab], { type: 'audio/wav' })
  }

  private assembleChannels(): Float32Array[] {
    const left = concat(this.chunksL, this.capturedFrames)
    if (this.numChannels === 1) return [left]
    const right = concat(this.chunksR, this.capturedFrames)
    return [left, right]
  }
}

function concat(chunks: Float32Array[], totalFrames: number): Float32Array {
  const out = new Float32Array(totalFrames)
  let offset = 0
  for (const chunk of chunks) {
    if (offset + chunk.length > totalFrames) {
      out.set(chunk.subarray(0, totalFrames - offset), offset)
      break
    }
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Build a download filename like `mspectr-glass-memory-2026-06-30-1432.wav`.
 * The Date is injected so the output is deterministic in tests.
 */
export function recordingFilename(label: string, date: Date): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'recording'
  const y = date.getFullYear()
  const mo = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  return `mspectr-${slug}-${y}-${mo}-${d}-${hh}${mm}.wav`
}

function pad2(n: number): string {
  // clamp guards against a malformed Date producing NaN/negative segments.
  const v = clamp(Math.floor(Number.isFinite(n) ? n : 0), 0, 9999)
  return v < 10 ? `0${v}` : String(v)
}
