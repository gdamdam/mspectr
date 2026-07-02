/**
 * Compact stereo reverb for the SPACE stage — a Freeverb-style bank of
 * lowpass-feedback comb filters into series allpasses, with a couple of early
 * reflection taps and a mid/side width control. Tunings are scaled to the
 * actual sample rate so behaviour is identical at 44.1/48/96 kHz. All delay
 * lines are preallocated; processing a block allocates nothing.
 *
 * This is a curated single stereo stage, not a general effects rack.
 */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
const STEREO_SPREAD = 23
const EARLY_TAPS = [190, 759, 44, 410]

class CombLP {
  private readonly buf: Float32Array
  private idx = 0
  private lp = 0
  feedback = 0.84
  damp = 0.2
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size))
  }
  process(input: number): number {
    const out = this.buf[this.idx]
    this.lp = out * (1 - this.damp) + this.lp * this.damp
    this.buf[this.idx] = input + this.lp * this.feedback
    if (++this.idx >= this.buf.length) this.idx = 0
    return out
  }
  clear(): void {
    this.buf.fill(0)
    this.lp = 0
  }
}

class Allpass {
  private readonly buf: Float32Array
  private idx = 0
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size))
  }
  process(input: number): number {
    const bufOut = this.buf[this.idx]
    const out = -input + bufOut
    this.buf[this.idx] = input + bufOut * 0.5
    if (++this.idx >= this.buf.length) this.idx = 0
    return out
  }
  clear(): void {
    this.buf.fill(0)
  }
}

export class StereoReverb {
  private readonly combL: CombLP[]
  private readonly combR: CombLP[]
  private readonly apL: Allpass[]
  private readonly apR: Allpass[]
  private readonly earlyBuf: Float32Array
  private readonly earlyTaps: number[]
  private earlyIdx = 0
  private readonly earlyLen: number

  /** 0..1 */ amount = 0.25
  /** 0..1 */ early = 0.2
  /** 0..1 */ diffusion = 0.3
  /** 0..1 */ width = 0.5

  constructor(sampleRate: number) {
    const scale = sampleRate / 44100
    const s = (n: number) => Math.max(1, Math.round(n * scale))
    this.combL = COMB_TUNING.map((t) => new CombLP(s(t)))
    this.combR = COMB_TUNING.map((t) => new CombLP(s(t + STEREO_SPREAD)))
    this.apL = ALLPASS_TUNING.map((t) => new Allpass(s(t)))
    this.apR = ALLPASS_TUNING.map((t) => new Allpass(s(t + STEREO_SPREAD)))
    this.earlyTaps = EARLY_TAPS.map((t) => s(t))
    this.earlyLen = Math.max(...this.earlyTaps) + 1
    this.earlyBuf = new Float32Array(this.earlyLen)
  }

  /** Process a stereo block in place. */
  process(left: Float32Array, right: Float32Array): void {
    const n = left.length
    const amount = Number.isFinite(this.amount) ? Math.max(0, Math.min(1, this.amount)) : 0
    const earlyAmount = Number.isFinite(this.early) ? Math.max(0, Math.min(1, this.early)) : 0
    const diffusion = Number.isFinite(this.diffusion) ? Math.max(0, Math.min(1, this.diffusion)) : 0
    const width = Number.isFinite(this.width) ? Math.max(0, Math.min(1, this.width)) : 0
    if (amount <= 0 && earlyAmount <= 0) return
    // Feedback/damp from amount: more amount → longer tail.
    const fb = 0.7 + 0.28 * this.amount
    const damp = 0.15 + 0.4 * (1 - diffusion)
    for (const c of this.combL) {
      c.feedback = fb
      c.damp = damp
    }
    for (const c of this.combR) {
      c.feedback = fb
      c.damp = damp
    }
    const wet = amount
    const earlyGain = earlyAmount * 0.6
    for (let i = 0; i < n; i++) {
      const dryL = Number.isFinite(left[i]) ? left[i] : 0
      const dryR = Number.isFinite(right[i]) ? right[i] : 0
      const mono = (dryL + dryR) * 0.5

      // Early reflections from a shared tap buffer.
      this.earlyBuf[this.earlyIdx] = mono
      let early = 0
      for (let t = 0; t < this.earlyTaps.length; t++) {
        const readIdx = (this.earlyIdx - this.earlyTaps[t] + this.earlyLen) % this.earlyLen
        early += this.earlyBuf[readIdx]
      }
      early *= earlyGain / this.earlyTaps.length

      // Comb bank (parallel) → allpass (series), per channel.
      let l = 0
      let r = 0
      for (let c = 0; c < this.combL.length; c++) {
        l += this.combL[c].process(mono)
        r += this.combR[c].process(mono)
      }
      l /= this.combL.length
      r /= this.combR.length
      for (let a = 0; a < this.apL.length; a++) {
        l = this.apL[a].process(l)
        r = this.apR[a].process(r)
      }
      // Reverb tail and early reflections have independent controls.
      const mid = (l + r) * 0.5
      const side = (l - r) * 0.5 * (0.3 + 1.4 * width)
      left[i] = dryL + wet * (mid + side) + early
      right[i] = dryR + wet * (mid - side) + early
      if (++this.earlyIdx >= this.earlyLen) this.earlyIdx = 0
    }
  }

  reset(): void {
    for (const c of this.combL) c.clear()
    for (const c of this.combR) c.clear()
    for (const a of this.apL) a.clear()
    for (const a of this.apR) a.clear()
    this.earlyBuf.fill(0)
    this.earlyIdx = 0
  }
}
