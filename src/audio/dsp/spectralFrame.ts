/**
 * SpectralFrame helpers: a one-sided (0..N/2) magnitude/phase representation of
 * an STFT frame, plus conversions to/from the full complex spectrum the FFT
 * operates on, and a fundamental estimate used only for display.
 *
 * Pitch model note: mspectr does NOT rely on fundamental detection to play a
 * spectrum. A captured spectrum is a timbre; the keyboard transposes it by
 * resampling the frequency axis (see resynth). `estimateFundamental` exists
 * purely so the UI can label a snapshot.
 */
import type { SpectralFrame } from '../contracts'

export function binCountFor(fftSize: number): number {
  return (fftSize >> 1) + 1
}

export function createFrame(fftSize: number, sampleRate: number): SpectralFrame {
  const binCount = binCountFor(fftSize)
  return {
    fftSize,
    binCount,
    sampleRate,
    magnitude: new Float32Array(binCount),
    phase: new Float32Array(binCount),
  }
}

/**
 * Fill `magnitude`/`phase` (length N/2+1) from a full complex spectrum
 * (length N). Magnitudes are NOT normalized by N here — callers that need
 * physical amplitude divide elsewhere; resynthesis is self-consistent.
 */
export function complexToPolar(
  re: Float32Array,
  im: Float32Array,
  magnitude: Float32Array,
  phase: Float32Array,
): void {
  const binCount = magnitude.length
  for (let k = 0; k < binCount; k++) {
    const r = re[k]
    const i = im[k]
    magnitude[k] = Math.hypot(r, i)
    phase[k] = Math.atan2(i, r)
  }
}

/**
 * Expand a one-sided magnitude/phase frame back into a full Hermitian-symmetric
 * complex spectrum (length N) ready for the inverse FFT, yielding a real signal.
 */
export function polarToComplex(
  magnitude: Float32Array,
  phase: Float32Array,
  re: Float32Array,
  im: Float32Array,
  fftSize: number,
): void {
  const binCount = magnitude.length // N/2 + 1
  re[0] = magnitude[0] * Math.cos(phase[0])
  im[0] = 0
  const nyquist = binCount - 1
  for (let k = 1; k < nyquist; k++) {
    const m = magnitude[k]
    const p = phase[k]
    const r = m * Math.cos(p)
    const i = m * Math.sin(p)
    re[k] = r
    im[k] = i
    // Hermitian mirror for the negative frequencies.
    re[fftSize - k] = r
    im[fftSize - k] = -i
  }
  // Nyquist bin is real.
  re[nyquist] = magnitude[nyquist] * Math.cos(phase[nyquist])
  im[nyquist] = 0
}

/** Copy a frame's spectral data into another (same size assumed). */
export function copyFrameData(
  srcMag: Float32Array,
  srcPhase: Float32Array,
  dstMag: Float32Array,
  dstPhase: Float32Array,
): void {
  dstMag.set(srcMag)
  dstPhase.set(srcPhase)
}

/**
 * Estimate the fundamental frequency (Hz) from a magnitude spectrum, for
 * display labelling only. Uses the Harmonic Product Spectrum within a musical
 * range; returns 0 when no clear pitch is present.
 */
export function estimateFundamental(
  magnitude: Float32Array,
  sampleRate: number,
  fftSize: number,
): number {
  const binCount = magnitude.length
  const binHz = sampleRate / fftSize
  const minHz = 50
  const maxHz = 2000
  const minBin = Math.max(1, Math.floor(minHz / binHz))
  const maxBin = Math.min(binCount - 1, Math.ceil(maxHz / binHz))
  if (maxBin <= minBin) return 0

  let bestBin = 0
  let bestScore = 0
  // Harmonic product spectrum with 3 harmonics.
  for (let k = minBin; k <= maxBin; k++) {
    let product = magnitude[k]
    const k2 = k * 2
    const k3 = k * 3
    if (k2 < binCount) product *= magnitude[k2]
    if (k3 < binCount) product *= magnitude[k3]
    if (product > bestScore) {
      bestScore = product
      bestBin = k
    }
  }
  if (bestScore <= 0) return 0
  return bestBin * binHz
}
