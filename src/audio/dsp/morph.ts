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
