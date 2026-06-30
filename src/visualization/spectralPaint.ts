/**
 * Pure, framework-free painting math for the spectral display.
 *
 * Nothing here touches the DOM or React — every function is a deterministic
 * transform over numbers / typed arrays so the canvas drawing logic stays unit
 * testable and the component file can focus purely on lifecycle + events.
 *
 * Conventions used throughout this module:
 *  - dB values arrive in the range [DB_FLOOR, DB_CEIL] = [-100, 0] (the contract
 *    range for `EngineTelemetry.spectrum` / `.frozen`).
 *  - `y` grows downward (canvas convention): a louder bin maps to a *smaller* y.
 *  - Colors are returned as `rgb()/rgba()` strings ready for canvas fill/stroke.
 */

import { DISPLAY_BINS } from '../audio/contracts'

/** Contract dB range for telemetry spectra. */
export const DB_FLOOR = -100
export const DB_CEIL = 0

/**
 * Spectral energy ramp, dark → hot, mapped across real emission-line hues
 * (H-gamma violet → H-beta cyan → Hg green → Na-D amber → H-alpha red). `t` is
 * normalized energy 0..1, so quiet bins sit cool/violet and peaks bloom red.
 */
const ENERGY_STOPS: ReadonlyArray<{ t: number; r: number; g: number; b: number }> = [
  { t: 0.0, r: 0x12, g: 0x16, b: 0x2c }, // near-field, barely lifted from the bench
  { t: 0.18, r: 0x8b, g: 0x7b, b: 0xf0 }, // violet  (~434 H-gamma)
  { t: 0.42, r: 0x4c, g: 0xc9, b: 0xf0 }, // cyan    (~486 H-beta)
  { t: 0.6, r: 0x6e, g: 0xe0, b: 0x7a }, // green   (~546 Hg)
  { t: 0.82, r: 0xf2, g: 0xc1, b: 0x4e }, // amber   (~589 Na-D)
  { t: 1.0, r: 0xef, g: 0x5d, b: 0x6c }, // red     (~656 H-alpha) peak
]

/**
 * Frozen/captured energy reads as a *cool steel-violet phosphor* afterglow —
 * hue-distinct from the warm multi-line live ramp so the held layer never reads
 * as the same material. Single hue, brightness tracks energy.
 */
const FROZEN_BASE = { r: 0x9a, g: 0xa6, b: 0xe0 }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Map a dB magnitude to a normalized vertical position 0..1, where 0 = floor
 * (bottom / silence) and 1 = ceiling (top / full energy). Monotonic in dB.
 * Out-of-range / non-finite input is clamped so it can never produce NaN.
 */
export function dbToNorm(db: number): number {
  if (!Number.isFinite(db)) return 0
  return clamp01((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR))
}

/**
 * dB → canvas y for a given drawable height. Louder ⇒ higher on screen ⇒
 * smaller y. Result is always within [0, height].
 */
export function dbToY(db: number, height: number): number {
  const h = Number.isFinite(height) && height > 0 ? height : 0
  return h - dbToNorm(db) * h
}

/**
 * Log-frequency bin → x. Bins are spaced linearly in frequency, but musical
 * spectra are better read on a log axis, so low bins get more horizontal room.
 * Index 0 maps to x=0, index (binCount-1) maps to x=width. Always within
 * [0, width]. `binCount` defaults to the contract DISPLAY_BINS.
 */
export function binToX(bin: number, width: number, binCount: number = DISPLAY_BINS): number {
  const w = Number.isFinite(width) && width > 0 ? width : 0
  const n = binCount > 1 ? binCount : 2
  const i = clamp01(bin / (n - 1))
  // log1p over [0,1] then renormalize by log(2) so endpoints land exactly on
  // [0, w]; biases resolution toward the low end without leaving gaps.
  const logged = Math.log1p(i) / Math.LN2
  return clamp01(logged) * w
}

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/**
 * Live spectral color for normalized energy `t` (0..1). Returns an `rgb(...)`
 * string sampled from the cyan→violet→magenta ramp. Endpoints are exact.
 * `alpha`, when given (0..1), produces an `rgba(...)` instead.
 */
export function energyColor(t: number, alpha?: number): string {
  const x = clamp01(Number.isFinite(t) ? t : 0)
  let lo = ENERGY_STOPS[0]
  let hi = ENERGY_STOPS[ENERGY_STOPS.length - 1]
  for (let i = 0; i < ENERGY_STOPS.length - 1; i++) {
    if (x >= ENERGY_STOPS[i].t && x <= ENERGY_STOPS[i + 1].t) {
      lo = ENERGY_STOPS[i]
      hi = ENERGY_STOPS[i + 1]
      break
    }
  }
  const span = hi.t - lo.t
  const local = span <= 0 ? 0 : (x - lo.t) / span
  const r = mixChannel(lo.r, hi.r, local)
  const g = mixChannel(lo.g, hi.g, local)
  const b = mixChannel(lo.b, hi.b, local)
  if (alpha === undefined) return `rgb(${r}, ${g}, ${b})`
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`
}

/**
 * Frozen/captured color — the cooled amber phosphor. Brightness scales with
 * energy `t`; alpha defaults to 1. Hue is constant so frozen energy reads as a
 * single held material rather than a second live spectrum.
 */
export function frozenColor(t: number, alpha = 1): string {
  const x = clamp01(Number.isFinite(t) ? t : 0)
  // Lift floor so even quiet frozen bins remain faintly visible (held energy),
  // then scale toward the base amber as energy rises.
  const lift = 0.35 + 0.65 * x
  const r = Math.round(FROZEN_BASE.r * lift)
  const g = Math.round(FROZEN_BASE.g * lift)
  const b = Math.round(FROZEN_BASE.b * lift)
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`
}

/**
 * Persistence / afterglow accumulation across frames.
 *
 * `out[i] = max(decay * prev[i], dbToNorm(current[i]))`
 *
 * Energy rises instantly to the live value and decays exponentially toward the
 * floor, producing the "captured energy develops visible persistence" look. The
 * result is bounded in [0,1] and always finite — silence and null inputs decay
 * cleanly toward 0 rather than producing NaN or unbounded growth.
 *
 * @param prev    previous accumulator (normalized 0..1), reused in place.
 * @param current incoming dB array (length must match `prev`), or null.
 * @param decay   per-frame retention 0..1 (e.g. 0.88). Clamped.
 */
export function accumulatePersistence(
  prev: Float32Array,
  current: Float32Array | null,
  decay: number,
): Float32Array {
  const k = clamp01(Number.isFinite(decay) ? decay : 0)
  for (let i = 0; i < prev.length; i++) {
    const decayed = prev[i] * k
    const live = current && i < current.length ? dbToNorm(current[i]) : 0
    const v = decayed > live ? decayed : live
    // Defensive: guarantee finite + bounded even if `prev` was somehow poisoned.
    prev[i] = Number.isFinite(v) ? clamp01(v) : 0
  }
  return prev
}

/**
 * Whether a telemetry spectrum carries any audible energy. All-floor (silence)
 * or null/empty returns false, so the renderer can honestly flatline instead of
 * inventing motion. A bin counts as energy when above the floor by `marginDb`.
 */
export function hasEnergy(spectrum: Float32Array | null | undefined, marginDb = 1): boolean {
  if (!spectrum || spectrum.length === 0) return false
  const threshold = DB_FLOOR + Math.max(0, marginDb)
  for (let i = 0; i < spectrum.length; i++) {
    if (Number.isFinite(spectrum[i]) && spectrum[i] > threshold) return true
  }
  return false
}

/** Clamp an XY coordinate pair to the unit square. Non-finite ⇒ 0. */
export function clampXY(x: number, y: number): { x: number; y: number } {
  const cx = Number.isFinite(x) ? clamp01(x) : 0
  const cy = Number.isFinite(y) ? clamp01(y) : 0
  return { x: cx, y: cy }
}
