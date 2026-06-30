/**
 * Overlap-add resynthesizer. Given a processed magnitude/phase frame each hop,
 * it inverse-FFTs, applies the synthesis window, accumulates into an internal
 * buffer, and emits exactly `hop` unity-gain output samples. The analysis
 * applied one Hann window; applying a Hann synthesis window here makes the
 * effective weight Hann², which COLA-normalizes to flat gain at hop = N/4.
 *
 * One FFT instance is shared across all voices (its tables are read-only and it
 * keeps no per-call state); each OverlapAdd owns only its accumulator + scratch,
 * and allocates nothing in `process`.
 */
import type { FFT } from './fft'
import { polarToComplex } from './spectralFrame'
import { hann, overlapNormalization } from './windows'

export class OverlapAdd {
  readonly fftSize: number
  readonly hop: number
  private readonly fft: FFT
  private readonly window: Float32Array
  private readonly norm: Float32Array
  private readonly acc: Float32Array
  private readonly re: Float32Array
  private readonly im: Float32Array

  constructor(fft: FFT, hop: number, window?: Float32Array) {
    this.fft = fft
    this.fftSize = fft.size
    this.hop = hop
    this.window = window ?? hann(fft.size)
    this.norm = overlapNormalization(this.window, hop)
    this.acc = new Float32Array(fft.size)
    this.re = new Float32Array(fft.size)
    this.im = new Float32Array(fft.size)
  }

  /**
   * Synthesize one hop. `out` must have length `hop`. Magnitude/phase are
   * one-sided (N/2+1). This overwrites `out` (it does not accumulate into it).
   */
  process(magnitude: Float32Array, phase: Float32Array, out: Float32Array): void {
    const { fftSize, hop, acc, re, im, window, norm } = this
    polarToComplex(magnitude, phase, re, im, fftSize)
    this.fft.inverse(re, im)
    // Windowed overlap-add into the accumulator.
    for (let i = 0; i < fftSize; i++) {
      acc[i] += re[i] * window[i]
    }
    // Emit the leading hop samples, unity-gain normalized.
    for (let i = 0; i < hop; i++) {
      out[i] = acc[i] / norm[i]
    }
    // Shift the accumulator left by hop; zero the freed tail.
    acc.copyWithin(0, hop)
    acc.fill(0, fftSize - hop)
  }

  reset(): void {
    this.acc.fill(0)
  }
}
