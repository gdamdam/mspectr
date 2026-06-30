/**
 * HARMONIZE — add a bounded number of pitch-shifted spectral voices at authored
 * intervals, mixed under the dry spectrum with gain compensation so adding
 * voices does not blow up the level.
 */
import { resampleSpectrum } from './shift'

/**
 * @param voices    how many of `intervals` to use (bounded by caller to
 *                  MAX_HARMONY_VOICES and by intervals.length)
 * @param intervals semitone offsets (from contracts INTERVAL_SETS)
 * @param mix       0..1 wet level of the harmonized voices
 * @param out       output magnitude (binCount)
 * @param scratch   scratch buffer (binCount)
 */
export function applyHarmonize(
  mag: Float32Array,
  voices: number,
  intervals: readonly number[],
  mix: number,
  out: Float32Array,
  scratch: Float32Array,
): void {
  const n = out.length
  const count = Math.min(Math.max(0, Math.floor(voices)), intervals.length)
  if (count <= 0 || mix <= 0) {
    out.set(mag)
    return
  }
  // Equal-power-ish compensation: total energy grows with voice count, so scale
  // the wet sum by 1/sqrt(count) and trim the dry a touch.
  const comp = mix / Math.sqrt(count + 1)
  out.set(mag)
  for (let v = 0; v < count; v++) {
    const ratio = Math.pow(2, intervals[v] / 12)
    resampleSpectrum(mag, ratio, scratch)
    for (let k = 0; k < n; k++) out[k] += comp * scratch[k]
  }
}
