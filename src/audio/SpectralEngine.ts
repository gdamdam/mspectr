/**
 * SpectralEngine — the composition layer that turns the pure DSP primitives and
 * the voice allocator into a playable spectral instrument. It is framework-free
 * (no React, no DOM, no AudioWorklet API), so it runs unchanged inside the
 * worklet and can be unit-tested in node.
 *
 * Per render block it:
 *   1. feeds input to the STFT analyzer (live spectrum for display + capture),
 *   2. produces instrument output one hop at a time into an output FIFO that
 *      decouples the worklet's 128-sample render quanta from the STFT hop.
 *
 * Per synthesized hop it:
 *   1. builds a shared processed base spectrum: morph(A,B) → tilt → blur → gate,
 *   2. for each active voice resamples that base to the note pitch, shifts the
 *      formant envelope, applies the inharmonic SHIFT, harmonizes, then
 *      overlap-adds with phase advanced per bin (locked or seeded-animated),
 *   3. sums voices with per-sample envelope ramps and equal-power panning,
 *   4. runs the SPACE reverb and the stereo-linked limiter.
 *
 * Pitch model: a captured spectrum is a timbre. Playing REF_NOTE reproduces it
 * as captured; other notes resample the magnitude axis. SHIFT (additive) and
 * FORMANT (envelope) are deliberately different operations from this.
 */
import {
  type CaptureMode,
  type QualityMode,
  type SnapshotSlot,
  type SpectralParams,
  type SpectralSnapshot,
  DEFAULT_PARAMS,
  INTERVAL_SETS,
  LIVE_BUFFER_SECONDS,
  MIN_POLYPHONY,
  SNAPSHOT_SCHEMA_VERSION,
  MAX_SNAPSHOT_FRAMES,
  clamp,
  qualityConfig,
} from './contracts'
import { FrameAverager, FrameSequenceCapturer, captureFrame } from './dsp/freeze'
import { FFT } from './dsp/fft'
import { applyBlur } from './dsp/blur'
import { applyFormant } from './dsp/formant'
import { applyFreqShift, resampleSpectrum, shiftBinsFor } from './dsp/shift'
import { applyHarmonize } from './dsp/harmonize'
import { applyTilt } from './dsp/tilt'
import { morphMagnitude, morphSpectra } from './dsp/morph'
import { SpectralGate } from './dsp/gate'
import { OverlapAdd } from './dsp/overlapAdd'
import { StereoReverb } from './dsp/reverb'
import { StereoLimiter } from './dsp/limiter'
import { StftAnalyzer } from './dsp/stft'
import { TWO_PI, baseBinOmega, findSpectralPeaks, lockPhasesToPeaks, makePhaseDrift, wrapPhase } from './dsp/phase'
import { estimateFundamental } from './dsp/spectralFrame'
import { VoiceAllocator } from '../instrument/voiceAllocator'

/** Note whose pitch reproduces a captured spectrum unchanged. */
const REF_NOTE = 60
const VOICE_GAIN = 0.22
/** Frames accumulated for the 'average' capture mode. */
const AVERAGE_FRAMES = 8
/** Slow spectral-breathing LFO rate for the MOTION macro (Hz). */
const MOTION_RATE_HZ = 0.12

interface Slot {
  /** Current interpolated frame (binCount) — what the resynth reads. */
  mag: Float32Array
  phase: Float32Array
  /** Frame-major store, MAX_SNAPSHOT_FRAMES * binCount. */
  framesMag: Float32Array
  framesPhase: Float32Array
  /** Number of stored frames (0 = empty, 1 = static, >1 = evolving). */
  frameCount: number
  /** Samples between frames (replay speed). */
  frameHop: number
  filled: boolean
  baseFrequency: number
  sourceLabel: string
  capturedAt: number
  isLiveDerived: boolean
}

class Voice {
  active = false
  note = 0
  velocity = 0
  state: 'idle' | 'attack' | 'decay' | 'sustain' | 'release' = 'idle'
  env = 0
  prevEnv = 0
  ola: OverlapAdd
  phaseAcc: Float32Array
  drift: (amount: number) => number

  constructor(fft: FFT, hop: number, binCount: number, seed: number) {
    this.ola = new OverlapAdd(fft, hop)
    this.phaseAcc = new Float32Array(binCount)
    this.drift = makePhaseDrift(seed)
  }

  reset(): void {
    this.active = false
    this.state = 'idle'
    this.env = 0
    this.prevEnv = 0
    this.ola.reset()
    this.phaseAcc.fill(0)
  }
}

export type SnapshotCapturedCallback = (slot: SnapshotSlot, snapshot: SpectralSnapshot) => void

export class SpectralEngine {
  readonly sampleRate: number
  private quality: QualityMode
  private fftSize: number
  private hop: number
  private binCount: number
  private maxVoices: number
  private polyphony: number
  private seed: number

  private fft!: FFT
  private analyzer!: StftAnalyzer
  private omega!: Float32Array
  private gate!: SpectralGate
  private voices!: Voice[]
  private allocator!: VoiceAllocator

  // Live frame + snapshots.
  private liveMag!: Float32Array
  private livePhase!: Float32Array
  private hasLiveFrame = false
  private analysisInput = new Float32Array(128)
  private frozenLive = false
  private slotA!: Slot
  private slotB!: Slot

  // Scratch (binCount).
  private s1!: Float32Array
  private s2!: Float32Array
  private bufA!: Float32Array
  private bufB!: Float32Array
  private fmEnv!: Float32Array
  private fmShifted!: Float32Array
  private harmScratch!: Float32Array
  private peaks!: Int32Array
  private synthPhase!: Float32Array

  // Output FIFO (stereo).
  private fifoL!: Float32Array
  private fifoR!: Float32Array
  private fifoSize = 0
  private fifoRead = 0
  private fifoWrite = 0
  private fifoCount = 0
  private hopL!: Float32Array
  private hopR!: Float32Array
  private mono!: Float32Array

  private reverb: StereoReverb
  private limiter: StereoLimiter

  private params: SpectralParams = { ...DEFAULT_PARAMS }
  // Smoothed continuous params that must not click.
  private smTranspose = 0
  private smOutGain = 1
  private bendSemitones = 0

  // Global modulation LFO.
  private lfoPhase = 0
  private tempoBpm = 120
  /** Per-hop effective formant (base + LFO), read by the per-voice chain. */
  private effFormant = 0
  /** Per-hop LFO offset applied to the flipbook scrub position. */
  private lfoPosOffset = 0

  // Capture state.
  private captureSlot: SnapshotSlot | null = null
  private captureMode: CaptureMode = 'frame'
  private averager!: FrameAverager
  private averaging = false
  private sequencer!: FrameSequenceCapturer
  private sequencing = false
  // Shared evolving-frame cursor (ping-pong so the loop never clicks).
  private frameCursor = 0
  private frameDir = 1
  private motionSamples = 0
  private onCaptured: SnapshotCapturedCallback | null = null

  /** Dedicated voice that sounds a snapshot endpoint at the reference pitch. */
  private auditionVoice!: Voice
  /** Slot the audition voice renders; held through its release fade. */
  private auditionRenderSlot: SnapshotSlot = 'A'
  private peak = 0

  constructor(sampleRate: number, quality: QualityMode = 'normal') {
    this.sampleRate = sampleRate
    this.quality = quality
    const cfg = qualityConfig(quality)
    this.fftSize = cfg.fftSize
    this.hop = cfg.hopSize
    this.maxVoices = cfg.maxVoices
    this.binCount = (cfg.fftSize >> 1) + 1
    this.polyphony = Math.min(6, cfg.maxVoices)
    this.seed = 0x1234
    this.reverb = new StereoReverb(sampleRate)
    this.limiter = new StereoLimiter(sampleRate)
    this.build()
  }

  setOnCaptured(cb: SnapshotCapturedCallback): void {
    this.onCaptured = cb
  }

  private build(): void {
    const { fftSize, hop, binCount } = this
    this.fft = new FFT(fftSize)
    this.analyzer = new StftAnalyzer(fftSize, hop)
    this.omega = baseBinOmega(binCount, fftSize, hop)
    this.gate = new SpectralGate(binCount)
    this.allocator = new VoiceAllocator(this.polyphony)
    this.voices = []
    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push(new Voice(this.fft, hop, binCount, (this.seed ^ (i * 0x9e3779b1)) >>> 0))
    }
    this.auditionVoice = new Voice(this.fft, hop, binCount, (this.seed ^ 0xa5a5a5a5) >>> 0)
    this.liveMag = new Float32Array(binCount)
    this.livePhase = new Float32Array(binCount)
    this.hasLiveFrame = false
    this.slotA = this.makeSlot(binCount)
    this.slotB = this.makeSlot(binCount)
    this.s1 = new Float32Array(binCount)
    this.s2 = new Float32Array(binCount)
    this.bufA = new Float32Array(binCount)
    this.bufB = new Float32Array(binCount)
    this.fmEnv = new Float32Array(binCount)
    this.fmShifted = new Float32Array(binCount)
    this.harmScratch = new Float32Array(binCount)
    this.peaks = new Int32Array(binCount)
    this.synthPhase = new Float32Array(binCount)
    this.fifoSize = fftSize * 2
    this.fifoL = new Float32Array(this.fifoSize)
    this.fifoR = new Float32Array(this.fifoSize)
    this.fifoRead = 0
    this.fifoWrite = 0
    this.fifoCount = 0
    this.hopL = new Float32Array(hop)
    this.hopR = new Float32Array(hop)
    this.mono = new Float32Array(hop)
    this.averager = new FrameAverager(binCount)
    this.sequencer = new FrameSequenceCapturer(binCount, MAX_SNAPSHOT_FRAMES)
    this.frameCursor = 0
    this.frameDir = 1
  }

  private makeSlot(binCount: number): Slot {
    return {
      mag: new Float32Array(binCount),
      phase: new Float32Array(binCount),
      framesMag: new Float32Array(binCount * MAX_SNAPSHOT_FRAMES),
      framesPhase: new Float32Array(binCount * MAX_SNAPSHOT_FRAMES),
      frameCount: 0,
      frameHop: this.hop,
      filled: false,
      baseFrequency: 0,
      sourceLabel: '',
      capturedAt: 0,
      isLiveDerived: false,
    }
  }

  // --- Parameter / control surface ---------------------------------------

  setParams(params: SpectralParams): void {
    this.params = params
    this.frozenLive = params.freeze
  }

  setPolyphony(value: number): void {
    this.polyphony = Math.round(clamp(value, MIN_POLYPHONY, this.maxVoices))
    const toRelease = this.allocator.setMaxVoices(this.polyphony)
    for (const idx of toRelease) this.releaseVoiceImmediate(idx)
  }

  /** Tempo for LFO sync (BPM); driven by the Link bridge when connected. */
  setTempo(bpm: number): void {
    if (Number.isFinite(bpm) && bpm > 0) this.tempoBpm = clamp(bpm, 20, 400)
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0
    for (let i = 0; i < this.voices.length; i++) {
      this.voices[i].drift = makePhaseDrift((this.seed ^ (i * 0x9e3779b1)) >>> 0)
    }
  }

  setQuality(quality: QualityMode): void {
    if (quality === this.quality) return
    const savedA = this.slotA.filled ? this.snapshotOf(this.slotA) : null
    const savedB = this.slotB.filled ? this.snapshotOf(this.slotB) : null
    this.quality = quality
    const cfg = qualityConfig(quality)
    this.panic()
    this.fftSize = cfg.fftSize
    this.hop = cfg.hopSize
    this.maxVoices = cfg.maxVoices
    this.binCount = (cfg.fftSize >> 1) + 1
    this.polyphony = Math.min(this.polyphony, cfg.maxVoices)
    this.build()
    if (savedA) this.loadSnapshot('A', savedA)
    if (savedB) this.loadSnapshot('B', savedB)
  }

  // --- Notes -------------------------------------------------------------

  noteOn(note: number, velocity: number): void {
    if (!Number.isFinite(note)) return
    const n = clamp(Math.round(note), 0, 127)
    const alloc = this.allocator.noteOn(n, clamp(Math.round(velocity), 1, 127))
    const v = this.voices[alloc.voiceIndex]
    if (!v) return
    v.active = true
    v.note = n
    v.velocity = clamp(Math.round(velocity), 1, 127)
    v.state = 'attack'
    if (!alloc.stolen) {
      v.env = 0
      v.prevEnv = 0
      v.phaseAcc.fill(0)
      v.ola.reset()
    }
  }

  noteOff(note: number): void {
    const indices = this.allocator.noteOff(clamp(Math.round(note), 0, 127))
    for (const idx of indices) {
      const v = this.voices[idx]
      if (v && v.active) v.state = 'release'
    }
  }

  sustain(on: boolean): void {
    const released = this.allocator.setSustain(on)
    for (const idx of released) {
      const v = this.voices[idx]
      if (v && v.active) v.state = 'release'
    }
  }

  pitchBend(semitones: number): void {
    this.bendSemitones = Number.isFinite(semitones) ? clamp(semitones, -48, 48) : 0
  }

  panic(): void {
    const indices = this.allocator.panic()
    for (const idx of indices) {
      const v = this.voices[idx]
      if (v) v.reset()
    }
    // Also hard-stop any voice the allocator no longer tracks.
    for (const v of this.voices) v.reset()
    this.auditionVoice.reset()
    this.bendSemitones = 0
  }

  private releaseVoiceImmediate(idx: number): void {
    const v = this.voices[idx]
    if (v && v.active) v.state = 'release'
  }

  // --- Snapshots ---------------------------------------------------------

  capture(slot: SnapshotSlot, mode: CaptureMode, sourceLabel = '', isLiveDerived = false, capturedAt = 0): void {
    this.captureSlot = slot
    this.captureMode = mode
    this.pendingLabel = sourceLabel
    this.pendingLive = isLiveDerived
    this.pendingAt = capturedAt
    if (this.frozenLive) {
      const target = slot === 'A' ? this.slotA : this.slotB
      captureFrame(this.liveMag, this.livePhase, target.mag, target.phase)
      target.framesMag.set(target.mag)
      target.framesPhase.set(target.phase)
      target.frameCount = 1
      target.frameHop = this.hop
      this.averaging = false
      this.sequencing = false
      this.finalizeCapture(target)
      return
    }
    if (mode === 'average') {
      this.averager.reset()
      this.averaging = true
    } else if (mode === 'evolving') {
      this.sequencer.reset()
      this.sequencing = true
    }
  }

  private pendingLabel = ''
  private pendingLive = false
  private pendingAt = 0

  loadSnapshot(slot: SnapshotSlot, snap: SpectralSnapshot): void {
    const target = slot === 'A' ? this.slotA : this.slotB
    const bc = this.binCount
    const srcBins = snap.binCount
    const fc = Math.min(Math.max(1, snap.frameCount || 1), MAX_SNAPSHOT_FRAMES)
    // Copy each frame, resampling the bin axis if the quality (binCount) differs.
    for (let f = 0; f < fc; f++) {
      const srcOff = f * srcBins
      const dstOff = f * bc
      if (srcBins === bc) {
        target.framesMag.set(snap.magnitude.subarray(srcOff, srcOff + bc), dstOff)
        if (snap.phase) target.framesPhase.set(snap.phase.subarray(srcOff, srcOff + bc), dstOff)
        else target.framesPhase.fill(0, dstOff, dstOff + bc)
      } else {
        const ratio = (srcBins - 1) / (bc - 1)
        for (let k = 0; k < bc; k++) {
          const i = Math.min(srcBins - 1, Math.floor(k * ratio))
          target.framesMag[dstOff + k] = snap.magnitude[srcOff + i] ?? 0
          target.framesPhase[dstOff + k] = snap.phase ? (snap.phase[srcOff + i] ?? 0) : 0
        }
      }
    }
    target.frameCount = fc
    target.frameHop = snap.frameHop > 0 ? snap.frameHop : this.hop
    target.mag.set(target.framesMag.subarray(0, bc))
    target.phase.set(target.framesPhase.subarray(0, bc))
    target.filled = true
    target.baseFrequency = snap.baseFrequency
    target.sourceLabel = snap.sourceLabel
    target.capturedAt = snap.capturedAt
    target.isLiveDerived = snap.isLiveDerived
  }

  clearSnapshot(slot: SnapshotSlot): void {
    const t = slot === 'A' ? this.slotA : this.slotB
    t.filled = false
    t.frameCount = 0
    t.mag.fill(0)
    t.phase.fill(0)
  }

  swapSnapshots(): void {
    const tmp = this.slotA
    this.slotA = this.slotB
    this.slotB = tmp
  }

  copySnapshot(from: SnapshotSlot, to: SnapshotSlot): void {
    const src = from === 'A' ? this.slotA : this.slotB
    const dst = to === 'A' ? this.slotA : this.slotB
    if (src === dst) return
    const len = Math.max(1, src.frameCount) * this.binCount
    dst.mag.set(src.mag)
    dst.phase.set(src.phase)
    dst.framesMag.set(src.framesMag.subarray(0, len))
    dst.framesPhase.set(src.framesPhase.subarray(0, len))
    dst.frameCount = src.frameCount
    dst.frameHop = src.frameHop
    dst.filled = src.filled
    dst.baseFrequency = src.baseFrequency
    dst.sourceLabel = src.sourceLabel
    dst.isLiveDerived = src.isLiveDerived
  }

  freezeLive(on: boolean): void {
    this.frozenLive = on
  }

  clearLive(): void {
    this.liveMag.fill(0)
    this.livePhase.fill(0)
    this.analyzer.reset()
    this.hasLiveFrame = false
  }

  setMonitor(_on: boolean): void {
    /* monitoring is a main-thread gain node; the engine ignores it. */
  }

  audition(slot: SnapshotSlot | null): void {
    const v = this.auditionVoice
    if (slot) {
      this.auditionRenderSlot = slot
      if (!v.active) {
        v.env = 0
        v.prevEnv = 0
        v.phaseAcc.fill(0)
        v.ola.reset()
      }
      v.active = true
      v.note = REF_NOTE
      v.velocity = 100
      v.state = 'attack'
    } else if (v.active) {
      v.state = 'release'
    }
  }

  // --- Render ------------------------------------------------------------

  /** Process one render block. `input` is mono; `outL`/`outR` are written. */
  render(input: Float32Array, outL: Float32Array, outR: Float32Array): void {
    // 1. Analysis on the incoming source.
    if (this.analysisInput.length !== input.length) this.analysisInput = new Float32Array(input.length)
    const inputGain = Math.pow(10, this.params.inputGainDb / 20)
    for (let i = 0; i < input.length; i++) {
      const sample = input[i]
      this.analysisInput[i] = Number.isFinite(sample) ? sample * inputGain : 0
    }
    const frames = this.analyzer.process(this.analysisInput)
    if (frames > 0) {
      if (!this.frozenLive || !this.hasLiveFrame) {
        this.liveMag.set(this.analyzer.magnitude)
        this.livePhase.set(this.analyzer.phase)
        this.hasLiveFrame = true
      }
      this.handleCapture()
    }

    // 2. Fill the output FIFO with instrument hops as needed, then drain.
    const n = outL.length
    while (this.fifoCount < n) this.synthHop()
    for (let i = 0; i < n; i++) {
      outL[i] = this.fifoL[this.fifoRead]
      outR[i] = this.fifoR[this.fifoRead]
      this.fifoRead = (this.fifoRead + 1) % this.fifoSize
      this.fifoCount--
    }
  }

  private handleCapture(): void {
    if (this.captureSlot === null) return
    const slot = this.captureSlot === 'A' ? this.slotA : this.slotB
    const bc = this.binCount
    if (this.frozenLive) {
      captureFrame(this.liveMag, this.livePhase, slot.mag, slot.phase)
      slot.framesMag.set(slot.mag.subarray(0, bc))
      slot.framesPhase.set(slot.phase.subarray(0, bc))
      slot.frameCount = 1
      slot.frameHop = this.hop
      this.averaging = false
      this.sequencing = false
      this.finalizeCapture(slot)
      return
    }
    if (this.captureMode === 'evolving' && this.sequencing) {
      // Living capture: accumulate a frame sequence, then store it whole.
      this.sequencer.add(this.analyzer.magnitude, this.analyzer.phase)
      if (!this.sequencer.full) return
      const fc = Math.max(1, this.sequencer.frames)
      slot.framesMag.set(this.sequencer.mag.subarray(0, fc * bc))
      slot.framesPhase.set(this.sequencer.phase.subarray(0, fc * bc))
      slot.frameCount = fc
      slot.frameHop = this.hop
      slot.mag.set(slot.framesMag.subarray(0, bc)) // current = first frame
      this.sequencing = false
      this.finalizeCapture(slot)
    } else if (this.captureMode === 'average' && this.averaging) {
      this.averager.add(this.analyzer.magnitude, this.analyzer.phase)
      if (this.averager.frames < AVERAGE_FRAMES) return
      this.averager.finish(slot.mag, slot.phase)
      slot.framesMag.set(slot.mag.subarray(0, bc))
      slot.framesPhase.set(slot.phase.subarray(0, bc))
      slot.frameCount = 1
      slot.frameHop = this.hop
      this.averaging = false
      this.finalizeCapture(slot)
    } else {
      captureFrame(this.analyzer.magnitude, this.analyzer.phase, slot.mag, slot.phase)
      slot.framesMag.set(slot.mag.subarray(0, bc))
      slot.framesPhase.set(slot.phase.subarray(0, bc))
      slot.frameCount = 1
      slot.frameHop = this.hop
      this.finalizeCapture(slot)
    }
  }

  private finalizeCapture(slot: Slot): void {
    slot.filled = true
    slot.baseFrequency = estimateFundamental(slot.mag, this.sampleRate, this.fftSize)
    slot.sourceLabel = this.pendingLabel
    slot.capturedAt = this.pendingAt
    slot.isLiveDerived = this.pendingLive
    const which = this.captureSlot as SnapshotSlot
    this.captureSlot = null
    if (this.onCaptured) {
      this.onCaptured(which, this.snapshotOf(slot))
    }
  }

  private snapshotOf(slot: Slot): SpectralSnapshot {
    const fc = Math.max(1, slot.frameCount)
    const len = fc * this.binCount
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      fftSize: this.fftSize,
      binCount: this.binCount,
      analysisSampleRate: this.sampleRate,
      baseFrequency: slot.baseFrequency,
      frameCount: fc,
      frameHop: slot.frameHop,
      magnitude: slot.framesMag.slice(0, len),
      phase: slot.framesPhase.slice(0, len),
      sourceLabel: slot.sourceLabel,
      capturedAt: slot.capturedAt,
      isLiveDerived: slot.isLiveDerived,
    }
  }

  /** Synthesize one hop of stereo instrument output into the FIFO. */
  private synthHop(): void {
    const { hop, hopL, hopR } = this
    const p = this.params

    // Smooth the parameters that must not click.
    const sc = 0.25
    this.smTranspose += sc * (p.transpose - this.smTranspose)
    const targetOut = Math.pow(10, p.outputGainDb / 20)
    this.smOutGain += sc * (targetOut - this.smOutGain)

    // Global modulation LFO (one sine shared across voices). Depth 0..1 maps to
    // each target's natural range; ±1 semitone-scaled for formant/shift.
    let lfoVal = 0
    if (p.lfoTarget !== 'off' && p.lfoDepth > 0) {
      const rateHz = p.lfoSync ? (this.tempoBpm / 60) * p.lfoRate : p.lfoRate
      this.lfoPhase += (TWO_PI * rateHz * hop) / this.sampleRate
      if (this.lfoPhase > TWO_PI) this.lfoPhase -= TWO_PI
      lfoVal = p.lfoDepth * Math.sin(this.lfoPhase)
    } else {
      this.lfoPhase = 0
    }
    const lfoOn = (t: typeof p.lfoTarget) => (p.lfoTarget === t ? lfoVal : 0)
    this.effFormant = clamp(p.formant + lfoOn('formant') * 12, -24, 24)
    this.lfoPosOffset = lfoOn('position')

    // Advance the shared evolving-frame cursor and refresh each filled slot's
    // current frame, so a living capture replays its own spectral motion.
    this.advanceFrameCursor()
    this.refreshSlotFrame(this.slotA)
    this.refreshSlotFrame(this.slotB)

    // Effective endpoints: a filled snapshot's current frame, else the live frame.
    const effA = this.slotA.filled ? this.slotA.mag : this.liveMag
    const effB = this.slotB.filled ? this.slotB.mag : this.liveMag

    // Shared processed base spectrum: envelope/fine-structure morph → tilt →
    // MOTION-breathed blur → gate. (fmEnv/fmShifted are free here — the per-voice
    // formant reuses them later in the hop.)
    const effMorph = clamp(p.morph + lfoOn('morph'), 0, 1)
    morphSpectra(effA, effB, effMorph, this.s1, this.fmEnv, this.fmShifted)
    const effTilt = clamp(p.tilt + lfoOn('tilt'), -1, 1)
    applyTilt(this.s1, effTilt, this.s2, this.sampleRate, this.fftSize)
    this.motionSamples += hop
    const motionLfo = Math.sin((TWO_PI * MOTION_RATE_HZ * this.motionSamples) / this.sampleRate)
    const effBlur = clamp(p.blur + p.phaseMotion * 0.25 * motionLfo + lfoOn('blur'), 0, 1)
    applyBlur(this.s2, effBlur, this.s1)
    this.gate.process(this.s1, p.gate, this.s2) // s2 = shared processed base

    hopL.fill(0)
    hopR.fill(0)

    const hopSeconds = hop / this.sampleRate
    const intervals = INTERVAL_SETS[p.harmonyInterval] ?? INTERVAL_SETS.octaves
    const shiftBins = shiftBinsFor(p.shift + lfoOn('shift') * 12, this.sampleRate, this.fftSize)
    const animate = p.freezePhase === 'animate'
    const motion = p.phaseMotion
    let activePeak = 0

    // Played notes render from the morphed base spectrum.
    for (const v of this.voices) {
      if (v.active) this.synthVoiceInto(v, this.s2, intervals, shiftBins, animate, motion, hopSeconds)
    }
    // Audition sounds a captured snapshot endpoint directly at the reference pitch.
    if (this.auditionVoice.active) {
      const slotMag = this.auditionRenderSlot === 'A' ? this.slotA.mag : this.slotB.mag
      this.synthVoiceInto(this.auditionVoice, slotMag, intervals, shiftBins, animate, motion, hopSeconds)
    }

    // SPACE stage.
    this.reverb.amount = p.reverbAmount
    this.reverb.early = p.earlyReflections
    this.reverb.diffusion = p.diffusion
    this.reverb.width = p.stereoWidth
    this.reverb.process(hopL, hopR)

    // Output gain + peak + limiter.
    for (let i = 0; i < hop; i++) {
      hopL[i] *= this.smOutGain
      hopR[i] *= this.smOutGain
      const a = Math.abs(hopL[i])
      const b = Math.abs(hopR[i])
      if (a > activePeak) activePeak = a
      if (b > activePeak) activePeak = b
    }
    this.peak = activePeak
    this.limiter.process(hopL, hopR)

    // Push into the FIFO.
    for (let i = 0; i < hop; i++) {
      this.fifoL[this.fifoWrite] = hopL[i]
      this.fifoR[this.fifoWrite] = hopR[i]
      this.fifoWrite = (this.fifoWrite + 1) % this.fifoSize
    }
    this.fifoCount += hop
  }

  /**
   * Advance the shared evolving-frame cursor within the performer-set loop
   * region, ping-ponging at the boundaries so playback never clicks. `frameSpeed`
   * scales the replay rate (0 = freeze, negative = start in reverse) and
   * `framePosition` scrubs manually while frozen. Static snapshots pin at 0.
   */
  private advanceFrameCursor(): void {
    const fcA = this.slotA.filled ? this.slotA.frameCount : 1
    const fcB = this.slotB.filled ? this.slotB.frameCount : 1
    const maxFrames = Math.max(fcA, fcB)
    if (maxFrames <= 1) {
      this.frameCursor = 0
      return
    }
    const p = this.params
    const maxPos = maxFrames - 1
    // Loop sub-range in frame units (tolerate reversed handles).
    let lo = clamp(p.frameLoopStart, 0, 1) * maxPos
    let hi = clamp(p.frameLoopEnd, 0, 1) * maxPos
    if (hi < lo) {
      const t = lo
      lo = hi
      hi = t
    }
    if (hi - lo < 1e-4) {
      this.frameCursor = lo
      return
    }
    if (p.frameSpeed === 0) {
      // Frozen: the scrub position (plus any LFO offset) maps into the region.
      this.frameCursor = lo + clamp(p.framePosition + this.lfoPosOffset, 0, 1) * (hi - lo)
      return
    }
    const fhop = this.slotA.filled && this.slotA.frameCount > 1 ? this.slotA.frameHop : this.slotB.frameHop
    const step = (this.hop / Math.max(1, fhop)) * Math.abs(p.frameSpeed)
    const dir = p.frameSpeed < 0 ? -this.frameDir : this.frameDir
    let pos = this.frameCursor + step * dir
    if (pos >= hi) {
      pos = hi
      this.frameDir = -this.frameDir
    } else if (pos <= lo) {
      pos = lo
      this.frameDir = -this.frameDir
    }
    this.frameCursor = clamp(pos, lo, hi)
  }

  /** Interpolate a filled slot's frame at the cursor into its current-frame buffer. */
  private refreshSlotFrame(slot: Slot): void {
    if (!slot.filled || slot.frameCount <= 1) return
    const bc = this.binCount
    const pos = Math.min(this.frameCursor, slot.frameCount - 1)
    const i = Math.floor(pos)
    const f = pos - i
    const a = i * bc
    const b = Math.min(i + 1, slot.frameCount - 1) * bc
    const fm = slot.framesMag
    const out = slot.mag
    const u = 1 - f
    for (let k = 0; k < bc; k++) out[k] = fm[a + k] * u + fm[b + k] * f
  }

  /** Advance a voice's envelope and overlap-add its spectral chain into the hop. */
  private synthVoiceInto(
    v: Voice,
    baseMag: Float32Array,
    intervals: readonly number[],
    shiftBins: number,
    animate: boolean,
    motion: number,
    hopSeconds: number,
  ): void {
    this.advanceEnvelope(v, hopSeconds)
    if (!v.active) return
    const p = this.params
    const binCount = this.binCount
    const hop = this.hop
    const pitchSemis = v.note - REF_NOTE + this.smTranspose + this.bendSemitones
    const ratio = Math.pow(2, pitchSemis / 12)
    resampleSpectrum(baseMag, ratio, this.bufA)
    // Key-tracked formant preservation: compensate the resample's envelope shift
    // so formants stay fixed under pitch (no chipmunk) as keytrackFormant → 1.
    const voiceFormant = clamp(this.effFormant - p.keytrackFormant * pitchSemis, -24, 24)
    applyFormant(this.bufA, voiceFormant, this.bufB, this.fmEnv, this.fmShifted)
    applyFreqShift(this.bufB, shiftBins, this.bufA)
    applyHarmonize(this.bufA, p.harmonyVoices, intervals, p.harmonyMix, this.bufB, this.harmScratch)

    // Velocity→brightness: hard notes tilt brighter, soft darker (per-voice).
    if (p.velTilt > 0) {
      const vt = clamp(p.velTilt * (v.velocity / 127 - 0.5) * 2, -1, 1)
      applyTilt(this.bufB, vt, this.harmScratch, this.sampleRate, this.fftSize)
      this.bufB.set(this.harmScratch)
    }

    const velGain = VOICE_GAIN * (0.25 + 0.75 * (v.velocity / 127))
    for (let k = 0; k < binCount; k++) this.bufB[k] *= velGain

    const phase = v.phaseAcc
    const omega = this.omega
    for (let k = 0; k < binCount; k++) {
      let ph = phase[k] + omega[k]
      if (animate && motion > 0) ph += v.drift(motion * 0.6)
      phase[k] = wrapPhase(ph)
    }
    // 'lock' mode: phase-lock partials around spectral peaks for a clearer, less
    // hollow tone; 'animate' keeps the drifting shimmer. Locking writes a copy so
    // the accumulator keeps advancing coherently underneath.
    let outPhase = phase
    if (!animate) {
      this.synthPhase.set(phase)
      const peakCount = findSpectralPeaks(this.bufB, this.peaks)
      lockPhasesToPeaks(this.synthPhase, this.bufB, this.peaks, peakCount)
      outPhase = this.synthPhase
    }
    v.ola.process(this.bufB, outPhase, this.mono)
    const mono = this.mono
    const pan = clamp((v.note - REF_NOTE) / 36, -1, 1) * 0.35
    const lg = Math.cos((pan + 1) * (Math.PI / 4))
    const rg = Math.sin((pan + 1) * (Math.PI / 4))
    const e0 = v.prevEnv
    const de = (v.env - e0) / hop
    for (let i = 0; i < hop; i++) {
      const e = e0 + de * i
      const s = mono[i] * e
      this.hopL[i] += s * lg
      this.hopR[i] += s * rg
    }
    v.prevEnv = v.env
  }

  private advanceEnvelope(v: Voice, dt: number): void {
    const p = this.params
    switch (v.state) {
      case 'attack': {
        const a = Math.max(0.001, p.attack)
        v.env += dt / a
        if (v.env >= 1) {
          v.env = 1
          v.state = 'decay'
        }
        break
      }
      case 'decay': {
        const d = Math.max(0.001, p.decay)
        v.env -= ((1 - p.sustain) * dt) / d
        if (v.env <= p.sustain) {
          v.env = p.sustain
          v.state = 'sustain'
        }
        break
      }
      case 'sustain':
        v.env = p.sustain
        break
      case 'release': {
        const r = Math.max(0.001, p.release)
        v.env -= dt / r
        if (v.env <= 0.0002) {
          v.env = 0
          v.active = false
          v.state = 'idle'
          v.ola.reset()
        }
        break
      }
      default:
        break
    }
  }

  // --- Telemetry helpers (called by the worklet at display rate) ---------

  get instrumentPeak(): number {
    return this.peak
  }

  get limiterGainReductionDb(): number {
    return this.limiter.gainReductionDb
  }

  activeVoices(): number {
    let c = 0
    for (const v of this.voices) if (v.active) c++
    return c
  }

  isFrozenLive(): boolean {
    return this.frozenLive
  }

  liveBufferSeconds(): number {
    return LIVE_BUFFER_SECONDS
  }

  snapshotFilled(slot: SnapshotSlot): boolean {
    return (slot === 'A' ? this.slotA : this.slotB).filled
  }

  /** Downsample a source magnitude spectrum to `dst` (dB), log-frequency. */
  fillDisplaySpectrum(dst: Float32Array, source: 'live' | 'morph'): void {
    let mag: Float32Array
    if (source === 'morph' && (this.slotA.filled || this.slotB.filled)) {
      const effA = this.slotA.filled ? this.slotA.mag : this.liveMag
      const effB = this.slotB.filled ? this.slotB.mag : this.liveMag
      morphMagnitude(effA, effB, clamp(this.params.morph, 0, 1), this.s1)
      mag = this.s1
    } else {
      mag = this.liveMag
    }
    const bins = dst.length
    const maxBin = this.binCount - 1
    for (let i = 0; i < bins; i++) {
      // Log-frequency band [loFrac, hiFrac] of the spectrum.
      const lo = Math.pow(maxBin, i / bins)
      const hi = Math.pow(maxBin, (i + 1) / bins)
      const a = Math.max(0, Math.floor(lo))
      const b = Math.min(maxBin, Math.max(a, Math.ceil(hi)))
      let m = 0
      for (let k = a; k <= b; k++) if (mag[k] > m) m = mag[k]
      // Normalize against fftSize (forward FFT is unnormalized) and convert to dB.
      const norm = m / (this.fftSize * 0.5)
      dst[i] = norm > 1e-6 ? Math.max(-100, 20 * Math.log10(norm)) : -100
    }
  }

  reset(): void {
    this.panic()
    this.clearLive()
    this.reverb.reset()
    this.limiter.reset()
    this.fifoRead = this.fifoWrite = this.fifoCount = 0
    this.fifoL.fill(0)
    this.fifoR.fill(0)
  }
}
