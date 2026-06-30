/**
 * Streaming STFT analyzer. Fed arbitrary-length blocks (the worklet's 128-sample
 * render quanta), it maintains an input ring buffer and emits a windowed
 * magnitude/phase frame every `hop` samples. All buffers are preallocated; the
 * audio loop does no allocation.
 */
import { FFT } from './fft'
import { complexToPolar } from './spectralFrame'
import { applyWindow, hann } from './windows'

export class StftAnalyzer {
  readonly fftSize: number
  readonly hop: number
  readonly binCount: number
  readonly magnitude: Float32Array
  readonly phase: Float32Array

  private readonly fft: FFT
  private readonly window: Float32Array
  private readonly ring: Float32Array
  private readonly frame: Float32Array
  private readonly re: Float32Array
  private readonly im: Float32Array
  private writePos = 0
  private filled = 0
  private hopCounter = 0

  constructor(fftSize: number, hop: number) {
    this.fftSize = fftSize
    this.hop = hop
    this.binCount = (fftSize >> 1) + 1
    this.fft = new FFT(fftSize)
    this.window = hann(fftSize)
    this.ring = new Float32Array(fftSize)
    this.frame = new Float32Array(fftSize)
    this.re = new Float32Array(fftSize)
    this.im = new Float32Array(fftSize)
    this.magnitude = new Float32Array(this.binCount)
    this.phase = new Float32Array(this.binCount)
  }

  /**
   * Push a block of input samples. Returns the number of new frames produced
   * (magnitude/phase reflect the most recent one). A NaN/Inf input sample is
   * coerced to 0 so a bad device can never poison the spectrum.
   */
  process(input: Float32Array): number {
    let produced = 0
    const { ring, fftSize, hop } = this
    for (let i = 0; i < input.length; i++) {
      const s = input[i]
      ring[this.writePos] = Number.isFinite(s) ? s : 0
      this.writePos = (this.writePos + 1) % fftSize
      if (this.filled < fftSize) this.filled++
      if (++this.hopCounter >= hop) {
        this.hopCounter = 0
        if (this.filled >= fftSize) {
          this.computeFrame()
          produced++
        }
      }
    }
    return produced
  }

  private computeFrame(): void {
    const { ring, fftSize, frame, window, re, im } = this
    // Read the most recent fftSize samples in time order. writePos points at the
    // oldest sample (the next slot to overwrite), so the window starts there.
    const start = this.writePos
    for (let n = 0; n < fftSize; n++) {
      frame[n] = ring[(start + n) % fftSize]
    }
    applyWindow(frame, window)
    re.set(frame)
    im.fill(0)
    this.fft.forward(re, im)
    complexToPolar(re, im, this.magnitude, this.phase)
  }

  reset(): void {
    this.ring.fill(0)
    this.writePos = 0
    this.filled = 0
    this.hopCounter = 0
    this.magnitude.fill(0)
    this.phase.fill(0)
  }
}
