/**
 * FREEZE — capture a spectral moment to hold and play.
 *
 * `captureFrame` grabs a single instantaneous frame. `FrameAverager` accumulates
 * a short region into an averaged magnitude for a smoother, less transient
 * capture (the 'average' capture mode). The phase strategy (lock vs animate) is
 * applied at resynthesis time, not here — this module only produces the held
 * magnitude/phase data, deterministically.
 */
export function captureFrame(
  srcMag: Float32Array,
  srcPhase: Float32Array,
  dstMag: Float32Array,
  dstPhase: Float32Array,
): void {
  dstMag.set(srcMag)
  dstPhase.set(srcPhase)
}

export class FrameAverager {
  private readonly sumMag: Float32Array
  private count = 0
  /** Phase of the first frame is kept as the representative phase. */
  private readonly firstPhase: Float32Array
  private hasPhase = false

  constructor(binCount: number) {
    this.sumMag = new Float32Array(binCount)
    this.firstPhase = new Float32Array(binCount)
  }

  reset(): void {
    this.sumMag.fill(0)
    this.firstPhase.fill(0)
    this.count = 0
    this.hasPhase = false
  }

  add(mag: Float32Array, phase: Float32Array): void {
    const n = this.sumMag.length
    for (let k = 0; k < n; k++) this.sumMag[k] += mag[k]
    if (!this.hasPhase) {
      this.firstPhase.set(phase)
      this.hasPhase = true
    }
    this.count++
  }

  get frames(): number {
    return this.count
  }

  /** Write the averaged magnitude and representative phase into the targets. */
  finish(dstMag: Float32Array, dstPhase: Float32Array): boolean {
    if (this.count === 0) return false
    const inv = 1 / this.count
    for (let k = 0; k < dstMag.length; k++) dstMag[k] = this.sumMag[k] * inv
    dstPhase.set(this.firstPhase)
    return true
  }
}

/**
 * Captures a SEQUENCE of frames (the 'evolving' / living capture): each analysed
 * frame is appended, frame-major, into preallocated stores until `maxFrames` is
 * reached. Replaying the sequence reproduces the source's own spectral motion
 * (attack → body → decay), so a pluck stays a pluck and a bell keeps ringing —
 * the biggest lever against the "static frozen pad" sameness.
 */
export class FrameSequenceCapturer {
  readonly mag: Float32Array
  readonly phase: Float32Array
  private readonly binCount: number
  private readonly maxFrames: number
  private count = 0

  constructor(binCount: number, maxFrames: number) {
    this.binCount = binCount
    this.maxFrames = maxFrames
    this.mag = new Float32Array(binCount * maxFrames)
    this.phase = new Float32Array(binCount * maxFrames)
  }

  reset(): void {
    this.count = 0
  }

  /** Append one frame. Returns false (and ignores it) once full. */
  add(mag: Float32Array, phase: Float32Array): boolean {
    if (this.count >= this.maxFrames) return false
    const off = this.count * this.binCount
    this.mag.set(mag, off)
    this.phase.set(phase, off)
    this.count++
    return true
  }

  get frames(): number {
    return this.count
  }

  get full(): boolean {
    return this.count >= this.maxFrames
  }
}
