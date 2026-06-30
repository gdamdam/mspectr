/**
 * FORMANT — move the spectral envelope while preserving the played pitch.
 *
 * We approximate the source-filter model cheaply: the broad spectral envelope is
 * a heavily smoothed magnitude curve; the fine structure (the partials that
 * carry pitch) is magnitude ÷ envelope. Shifting only the envelope and
 * recombining moves the formants up/down without moving the partials — so the
 * fundamental the listener hears stays put, unlike SHIFT or transposition.
 */
import { resampleSpectrum } from './shift'

/** Envelope smoothing radius — broad enough to discard pitch fine-structure. */
const ENVELOPE_DIVISOR = 16

/** Compute a broad spectral envelope (box blur) into `env`. */
export function spectralEnvelope(mag: Float32Array, env: Float32Array): void {
  const n = mag.length
  const r = Math.max(2, Math.floor(n / ENVELOPE_DIVISOR))
  const width = 2 * r + 1
  let sum = 0
  for (let j = -r; j <= r; j++) sum += mag[clampIndex(j, n)]
  for (let i = 0; i < n; i++) {
    env[i] = sum / width
    sum += mag[clampIndex(i + 1 + r, n)] - mag[clampIndex(i - r, n)]
  }
}

/**
 * @param semitones envelope shift; positive moves formants up.
 * @param env     scratch buffer (binCount) for the envelope
 * @param shifted scratch buffer (binCount) for the resampled envelope
 */
export function applyFormant(
  mag: Float32Array,
  semitones: number,
  out: Float32Array,
  env: Float32Array,
  shifted: Float32Array,
): void {
  const n = out.length
  if (semitones === 0) {
    out.set(mag)
    return
  }
  spectralEnvelope(mag, env)
  const ratio = Math.pow(2, semitones / 12)
  resampleSpectrum(env, ratio, shifted)
  for (let k = 0; k < n; k++) {
    const e = env[k]
    // detail = mag/env; recombine with the shifted envelope.
    const detail = e > 1e-9 ? mag[k] / e : 0
    out[k] = detail * shifted[k]
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i
}
