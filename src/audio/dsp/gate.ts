/**
 * SPECTRAL GATE — remove energy below a threshold relative to the per-frame
 * peak. Each bin has a smoothed gain that eases toward its target (1 above the
 * threshold, tapering below it through a soft knee), which prevents the
 * zippering and rapid bin chatter a hard per-frame gate would produce.
 */
export class SpectralGate {
  private readonly gain: Float32Array
  /** Smoothing coefficient per frame, 0..1 (higher = faster). */
  private readonly coeff: number

  constructor(binCount: number, smoothing = 0.35) {
    this.gain = new Float32Array(binCount)
    this.gain.fill(1)
    this.coeff = smoothing < 0 ? 0 : smoothing > 1 ? 1 : smoothing
  }

  /**
   * @param threshold 0..1, fraction of the per-frame peak below which bins are
   *        attenuated. 0 = fully open (passthrough).
   */
  process(mag: Float32Array, threshold: number, out: Float32Array): void {
    const n = mag.length
    if (threshold <= 0) {
      // Open gate: ease gains back to 1 and pass through.
      for (let k = 0; k < n; k++) {
        this.gain[k] += this.coeff * (1 - this.gain[k])
        out[k] = mag[k] * this.gain[k]
      }
      return
    }
    let peak = 0
    for (let k = 0; k < n; k++) if (mag[k] > peak) peak = mag[k]
    if (peak <= 0) {
      out.set(mag)
      return
    }
    const thr = threshold * peak
    const knee = thr * 0.5 + 1e-9
    for (let k = 0; k < n; k++) {
      const m = mag[k]
      let target: number
      if (m >= thr) target = 1
      else {
        // Soft knee below threshold: smooth 0..1 ramp over [thr-knee, thr].
        const x = (m - (thr - knee)) / knee
        target = x <= 0 ? 0 : x >= 1 ? 1 : x * x
      }
      const g = this.gain[k] + this.coeff * (target - this.gain[k])
      this.gain[k] = g
      out[k] = m * g
    }
  }

  reset(): void {
    this.gain.fill(1)
  }
}
