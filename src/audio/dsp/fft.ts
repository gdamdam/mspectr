/**
 * Radix-2 iterative Cooley–Tukey FFT.
 *
 * Implemented locally (no dependency) because a standard radix-2 transform is
 * small, deterministic, and trivially safe inside an AudioWorklet — none of the
 * reasons to take on an external FFT apply here. Tables (bit-reversal + twiddle)
 * are precomputed once per size; transforms run in place on caller-owned
 * Float32Arrays with no per-call allocation, so this is safe in the audio loop.
 *
 * Convention: forward uses e^{-jθ}; `inverse` applies the 1/N scaling so that
 * inverse(forward(x)) == x.
 */
export class FFT {
  readonly size: number
  private readonly cosTable: Float32Array
  private readonly sinTable: Float32Array
  private readonly reverse: Uint32Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two >= 2, got ${size}`)
    }
    this.size = size
    const half = size >> 1
    this.cosTable = new Float32Array(half)
    this.sinTable = new Float32Array(half)
    for (let i = 0; i < half; i++) {
      const angle = (2 * Math.PI * i) / size
      this.cosTable[i] = Math.cos(angle)
      this.sinTable[i] = Math.sin(angle)
    }
    // Bit-reversal permutation table.
    const bits = Math.round(Math.log2(size))
    this.reverse = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let x = i
      let r = 0
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1)
        x >>= 1
      }
      this.reverse[i] = r
    }
  }

  /** In-place complex transform. `inverse` divides by N. */
  private transform(re: Float32Array, im: Float32Array, inverse: boolean): void {
    const n = this.size
    const rev = this.reverse
    // Bit-reversal reordering.
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    const cosTable = this.cosTable
    const sinTable = this.sinTable
    // Butterflies.
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1
      const tableStep = n / len
      for (let i = 0; i < n; i += len) {
        for (let k = 0, idx = 0; k < halfLen; k++, idx += tableStep) {
          const a = i + k
          const b = a + halfLen
          const cos = cosTable[idx]
          const sin = inverse ? sinTable[idx] : -sinTable[idx]
          const tpre = re[b] * cos - im[b] * sin
          const tpim = re[b] * sin + im[b] * cos
          re[b] = re[a] - tpre
          im[b] = im[a] - tpim
          re[a] += tpre
          im[a] += tpim
        }
      }
    }
    if (inverse) {
      const invN = 1 / n
      for (let i = 0; i < n; i++) {
        re[i] *= invN
        im[i] *= invN
      }
    }
  }

  forward(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, false)
  }

  inverse(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, true)
  }
}
