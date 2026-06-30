import { describe, expect, it } from 'vitest'
import { FFT } from './fft'
import { OverlapAdd } from './overlapAdd'
import { StftAnalyzer } from './stft'

function rms(a: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}

/** Best normalized cross-correlation of `out` vs `ref` over a small delay search. */
function bestCorrelation(out: Float32Array, ref: Float32Array, from: number, to: number, maxDelay: number): number {
  let best = -Infinity
  const refRms = rms(ref, from, to)
  const outRms = rms(out, from, to)
  if (refRms === 0 || outRms === 0) return 0
  for (let d = 0; d <= maxDelay; d++) {
    let dot = 0
    for (let i = from; i < to; i++) dot += out[i] * ref[i - d]
    const corr = dot / ((to - from) * refRms * outRms)
    if (corr > best) best = corr
  }
  return best
}

describe('STFT + overlap-add reconstruction', () => {
  it('reconstructs a steady sine with flat gain across hop sizes', () => {
    for (const [fftSize, hop] of [
      [1024, 256],
      [2048, 512],
    ] as const) {
      const sr = 48000
      const analyzer = new StftAnalyzer(fftSize, hop)
      const fft = new FFT(fftSize)
      const ola = new OverlapAdd(fft, hop)

      const total = fftSize * 12
      const amp = 0.5
      const bin = 40
      const freq = (bin * sr) / fftSize // exact bin centre
      const input = new Float32Array(total)
      for (let i = 0; i < total; i++) input[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)

      const output = new Float32Array(total)
      let outPos = 0
      const block = new Float32Array(hop)
      const o = new Float32Array(hop)
      for (let start = 0; start + hop <= total; start += hop) {
        for (let i = 0; i < hop; i++) block[i] = input[start + i]
        if (analyzer.process(block) > 0) {
          ola.process(analyzer.magnitude, analyzer.phase, o)
          output.set(o, outPos)
          outPos += hop
        }
      }

      // Steady-state window, past the analysis latency.
      const from = fftSize * 4
      const to = outPos - fftSize
      expect(to).toBeGreaterThan(from)

      // Flat gain: output RMS ≈ input RMS.
      const outRms = rms(output, from, to)
      const inRms = amp / Math.SQRT2
      expect(outRms).toBeGreaterThan(inRms * 0.9)
      expect(outRms).toBeLessThan(inRms * 1.1)

      // Same waveform (allowing for the chain's group delay).
      const corr = bestCorrelation(output, input, from, to, fftSize)
      expect(corr).toBeGreaterThan(0.99)

      // Everything finite.
      for (let i = 0; i < outPos; i++) expect(Number.isFinite(output[i])).toBe(true)
    }
  })

  it('produces silence (no NaN) from a silent input', () => {
    const analyzer = new StftAnalyzer(1024, 256)
    const fft = new FFT(1024)
    const ola = new OverlapAdd(fft, 256)
    const block = new Float32Array(256)
    const o = new Float32Array(256)
    for (let k = 0; k < 40; k++) {
      if (analyzer.process(block) > 0) ola.process(analyzer.magnitude, analyzer.phase, o)
    }
    for (let i = 0; i < o.length; i++) expect(o[i]).toBe(0)
  })
})
