/**
 * MORPH — interpolate between two magnitude spectra A and B.
 *
 * A naive linear blend of two unrelated spectra collapses in loudness at the
 * midpoint (energy that sits in different bins averages toward half). To keep
 * the morph musically useful we blend linearly, then rescale the result so its
 * energy follows the interpolation of the two endpoints' energies. At t=0 and
 * t=1 the output is exactly A and B (endpoint identity).
 */
export function spectralEnergy(mag: Float32Array): number {
  let e = 0
  for (let k = 0; k < mag.length; k++) e += mag[k] * mag[k]
  return e
}

export function morphMagnitude(a: Float32Array, b: Float32Array, t: number, out: Float32Array): void {
  const n = out.length
  const u = 1 - t
  let ea = 0
  let eb = 0
  let eo = 0
  for (let k = 0; k < n; k++) {
    const av = a[k]
    const bv = b[k]
    const m = u * av + t * bv
    out[k] = m
    ea += av * av
    eb += bv * bv
    eo += m * m
  }
  const target = u * ea + t * eb
  if (eo > 1e-12 && target > 0) {
    const g = Math.sqrt(target / eo)
    for (let k = 0; k < n; k++) out[k] *= g
  }
}

/**
 * ENVELOPE + FINE-STRUCTURE MORPH — a perceptually smoother alternative to
 * morphMagnitude for DISSIMILAR spectra.
 *
 * A plain linear blend of two unrelated spectra just cross-fades amplitude:
 * A's peaks fade out while B's fade in, and the in-between never sounds like a
 * real intermediate timbre. Here we borrow the source-filter split used by
 * FORMANT: each input is separated into a broad spectral ENVELOPE (heavy box
 * smoothing, radius ~ binCount/16) and the fine STRUCTURE (mag / envelope, the
 * partials). Envelope and structure are interpolated INDEPENDENTLY by t and
 * recombined. Because the envelope glide moves the broad shape (and hence the
 * centroid) continuously, the morph passes through plausible intermediate
 * timbres rather than a double-humped crossfade.
 *
 * The envelope is interpolated in the LOG domain (geometric mean at t=0.5).
 * Log-domain blending gives a smoother, more monotonic centroid glide between a
 * bright and a dark spectrum than a linear blend, which would keep both humps
 * visible until one wins. Fine structure is interpolated LINEARLY.
 *
 * Recombined output = interpEnvelope * interpStructure is then energy-normalised
 * to energy = lerp(||a||, ||b||), the same loudness-preserving convention as
 * morphMagnitude. At t=0/1 the output equals a/b exactly (endpoint identity via
 * short-circuit). Divide-by-zero is guarded with an envelope floor of 1e-9.
 *
 * @param out          output magnitudes (binCount)
 * @param envScratch   scratch buffer (binCount) — reused for both envelopes
 * @param structScratch scratch buffer (binCount) — reused for both structures
 */
export function morphSpectra(
  a: Float32Array,
  b: Float32Array,
  t: number,
  out: Float32Array,
  envScratch: Float32Array,
  structScratch: Float32Array,
): void {
  const n = out.length
  // Endpoint identity: return the input untouched (no smoothing round-trip).
  if (t <= 0) {
    out.set(a)
    return
  }
  if (t >= 1) {
    out.set(b)
    return
  }

  const u = 1 - t
  const EPS = 1e-9

  // --- Input A: envelope into envScratch, structure into structScratch. ---
  boxEnvelope(a, envScratch)
  let ea = 0
  for (let k = 0; k < n; k++) {
    const e = envScratch[k]
    // interpEnvelope starts as the log-domain contribution of A's envelope.
    // structScratch holds A's fine structure (mag / envelope).
    structScratch[k] = a[k] / (e > EPS ? e : EPS)
    // Begin log-domain envelope blend: u * ln(envA).
    out[k] = u * Math.log(e > EPS ? e : EPS)
    ea += a[k] * a[k]
  }

  // --- Input B: envelope reuses envScratch; accumulate the blended parts. ---
  boxEnvelope(b, envScratch)
  let eb = 0
  for (let k = 0; k < n; k++) {
    const e = envScratch[k]
    // Finish log-domain envelope blend, then exponentiate back to linear.
    const logEnv = out[k] + t * Math.log(e > EPS ? e : EPS)
    const interpEnv = Math.exp(logEnv)
    // Linear blend of fine structure (A already in structScratch).
    const structB = b[k] / (e > EPS ? e : EPS)
    const interpStruct = u * structScratch[k] + t * structB
    out[k] = interpEnv * interpStruct
    eb += b[k] * b[k]
  }

  // --- Energy normalise to lerp of the two input energies. ---
  let eo = 0
  for (let k = 0; k < n; k++) {
    const v = out[k] < 0 ? 0 : out[k] // clamp tiny negatives from blending
    out[k] = v
    eo += v * v
  }
  const target = u * ea + t * eb
  if (eo > 1e-12 && target > 0) {
    const g = Math.sqrt(target / eo)
    for (let k = 0; k < n; k++) out[k] *= g
  }
}

/**
 * Broad spectral envelope via a running box blur (edge-clamped), radius
 * ~ binCount/16 — the same approach as FORMANT's spectralEnvelope.
 */
function boxEnvelope(mag: Float32Array, env: Float32Array): void {
  const n = mag.length
  const r = Math.max(2, Math.floor(n / 16))
  const width = 2 * r + 1
  let sum = 0
  for (let j = -r; j <= r; j++) sum += mag[clampIndex(j, n)]
  for (let i = 0; i < n; i++) {
    env[i] = sum / width
    sum += mag[clampIndex(i + 1 + r, n)] - mag[clampIndex(i - r, n)]
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i
}
