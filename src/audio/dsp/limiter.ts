/**
 * Stereo-linked look-ahead-free brickwall limiter — the final safety stage.
 *
 * A peak envelope follower (fast attack, slow release) computes a single gain
 * from the louder of the two channels so the stereo image is preserved. A hard
 * clamp at the ceiling backstops the envelope so the output can never exceed
 * the ceiling even on a transient the follower hasn't caught yet.
 */
import { dbToGain, LIMITER_CEILING_DB } from '../contracts'

export class StereoLimiter {
  private env = 0
  private readonly ceiling: number
  private readonly attackCoeff: number
  private readonly releaseCoeff: number
  /** Peak gain reduction (dB, >= 0) over the last processed block — telemetry. */
  gainReductionDb = 0

  constructor(sampleRate: number, ceilingDb = LIMITER_CEILING_DB, attackMs = 0.8, releaseMs = 120) {
    this.ceiling = dbToGain(ceilingDb)
    this.attackCoeff = Math.exp(-1 / (sampleRate * (attackMs / 1000)))
    this.releaseCoeff = Math.exp(-1 / (sampleRate * (releaseMs / 1000)))
  }

  process(left: Float32Array, right: Float32Array): void {
    const n = left.length
    const ceiling = this.ceiling
    let maxGr = 0
    for (let i = 0; i < n; i++) {
      let l = left[i]
      let r = right[i]
      if (!Number.isFinite(l)) l = 0
      if (!Number.isFinite(r)) r = 0
      const peak = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r)
      const coeff = peak > this.env ? this.attackCoeff : this.releaseCoeff
      this.env = peak + coeff * (this.env - peak)
      let gain = 1
      if (this.env > ceiling) gain = ceiling / this.env
      l *= gain
      r *= gain
      // Hard backstop — guarantees the ceiling regardless of follower lag.
      if (l > ceiling) l = ceiling
      else if (l < -ceiling) l = -ceiling
      if (r > ceiling) r = ceiling
      else if (r < -ceiling) r = -ceiling
      left[i] = l
      right[i] = r
      if (gain < 1) {
        const gr = -20 * Math.log10(gain)
        if (gr > maxGr) maxGr = gr
      }
    }
    this.gainReductionDb = maxGr
  }

  reset(): void {
    this.env = 0
    this.gainReductionDb = 0
  }
}
