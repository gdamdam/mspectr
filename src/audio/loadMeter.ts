/**
 * Render-load estimator with smoothing + hysteresis, extracted from the spectral
 * worklet so the threshold logic can be simulated deterministically in tests
 * (the worklet itself cannot be instantiated outside an AudioWorkletGlobalScope).
 *
 * The worklet accumulates the wall time its DSP render() consumes over one
 * telemetry window along with the number of frames rendered, then folds that
 * window into this meter. `value` is the smoothed fraction of the real-time
 * deadline used (renderMs / (frames/sampleRate * 1000)); `update` returns true
 * only when the latched overload state flips, so the worklet posts an event on
 * transitions rather than every window. Two thresholds (on > off) give the
 * hysteresis that stops a load hovering near the line from flickering the UI.
 */

export interface LoadMeterConfig {
  /** Assert overload once the smoothed load rises above this (0..1+). */
  onThreshold: number
  /** Clear overload only once the smoothed load falls below this. */
  offThreshold: number
  /** EMA weight applied to each window's load ratio, 0..1. */
  ema: number
}

export const DEFAULT_LOAD_METER: LoadMeterConfig = { onThreshold: 0.85, offThreshold: 0.6, ema: 0.3 }

export class LoadMeter {
  private load = 0
  private overloaded = false
  private readonly cfg: LoadMeterConfig

  constructor(cfg: LoadMeterConfig = DEFAULT_LOAD_METER) {
    this.cfg = cfg
  }

  /** Smoothed load, 0..(capped at 4). Report as min(1, value) in telemetry. */
  get value(): number {
    return this.load
  }

  get isOverloaded(): boolean {
    return this.overloaded
  }

  /**
   * Fold one telemetry window's render cost into the smoothed estimate.
   * @returns true when the latched overload state changed this call.
   */
  update(renderMs: number, frames: number, sampleRate: number): boolean {
    if (frames > 0 && sampleRate > 0) {
      const budgetMs = (frames / sampleRate) * 1000
      const windowLoad = budgetMs > 0 && Number.isFinite(renderMs) ? renderMs / budgetMs : 0
      // Clamp the raw ratio so a single wild sample can't spike the smoothed value
      // beyond a sane bound; negatives (clock going backwards) become 0.
      const clamped = windowLoad < 0 ? 0 : windowLoad > 4 ? 4 : windowLoad
      this.load += this.cfg.ema * (clamped - this.load)
    }
    const next = this.overloaded ? this.load > this.cfg.offThreshold : this.load > this.cfg.onThreshold
    const changed = next !== this.overloaded
    this.overloaded = next
    return changed
  }

  reset(): void {
    this.load = 0
    this.overloaded = false
  }
}
