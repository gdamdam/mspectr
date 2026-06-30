/**
 * Snapshot wire codec — quantize a SpectralSnapshot to a compact, validated
 * SerializedSnapshot and back.
 *
 * Quantization scheme (see REQUIREMENTS):
 *  - magnitude (linear) → dB via gainToDb, clamped to [floorDb, 0], then mapped
 *    linearly onto a single byte 0..255. floorDb is stored in the wire form so
 *    the decoder reconstructs the exact same dB window. Round-trip magnitude is
 *    accurate to ~half a quantization step (≈0.4 dB for the default 100 dB
 *    window / 255 levels).
 *  - phase (optional, radians) → byte 0..255 over [-π, π].
 *  - byte arrays are base64url encoded with no padding (URL/fragment safe).
 *
 * deserializeSnapshot is a SECURITY BOUNDARY. It validates the schema version,
 * that fftSize is a power of two within [MIN_FFT_SIZE, MAX_FFT_SIZE], that
 * binCount === fftSize/2 + 1, that the decoded magnitude byte length is exactly
 * binCount, that phase (if present) decodes to exactly binCount bytes, and that
 * every scalar is finite. It NEVER allocates an array sized by un-validated
 * input: fftSize/binCount are checked against MAX_FFT_SIZE before any Float32
 * buffer is created, and the base64 length is checked before decoding.
 */
import {
  MAX_FFT_SIZE,
  MIN_FFT_SIZE,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  gainToDb,
  type SerializedSnapshot,
  type SpectralSnapshot,
} from '../audio/contracts'

// ---------------------------------------------------------------------------
// base64url (no padding) — shared by patchLink.ts. Works in the browser
// (atob/btoa over latin1) and in the node test environment (Buffer). We avoid
// padding so the strings are safe inside a URL fragment.
// ---------------------------------------------------------------------------

/** Encode raw bytes as base64url, no `=` padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let b64: string
  if (typeof btoa === 'function') {
    // btoa wants a binary string. Chunk to avoid call-stack limits on big inputs.
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    b64 = btoa(binary)
  } else {
    // Node / non-DOM environments.
    b64 = Buffer.from(bytes).toString('base64')
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode a base64url string to bytes. If `maxBytes` is provided, the input is
 * rejected (throws) when it would decode to more than `maxBytes` bytes — this
 * is the allocation guard for the security boundary, so a hostile string can
 * never force a huge buffer. The actual decoded length is returned as-is for
 * the caller to check exactly.
 */
export function base64UrlToBytes(input: string, maxBytes?: number): Uint8Array {
  if (typeof input !== 'string') {
    throw new Error('base64UrlToBytes: input is not a string')
  }
  // Restore standard alphabet; padding is optional for decoders we use.
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*$/.test(normalized)) {
    throw new Error('base64UrlToBytes: contains non-base64 characters')
  }
  // base64 packs 4 chars → 3 bytes. Guard the implied length up front.
  if (maxBytes !== undefined) {
    const impliedMax = Math.ceil(normalized.length / 4) * 3
    if (impliedMax > maxBytes + 3) {
      throw new Error(
        `base64UrlToBytes: decoded length would exceed ${maxBytes} bytes`,
      )
    }
  }
  if (typeof atob === 'function') {
    const binary = atob(normalized)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

/** Default dB floor for magnitude quantization (anything quieter clamps here). */
export const DEFAULT_MAG_FLOOR_DB = -100
/** Phase quantizes over the full circle. */
const PHASE_MIN = -Math.PI
const PHASE_MAX = Math.PI
const PHASE_RANGE = PHASE_MAX - PHASE_MIN

function isPow2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0
}

/** Map a value in [lo, hi] to an integer byte 0..255 (clamped). */
function quantizeByte(value: number, lo: number, hi: number): number {
  const span = hi - lo
  if (span <= 0) return 0
  const t = (value - lo) / span
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  // Round to nearest of 256 levels.
  return Math.round(clamped * 255)
}

/** Inverse of quantizeByte: byte 0..255 → value in [lo, hi]. */
function dequantizeByte(byte: number, lo: number, hi: number): number {
  return lo + (byte / 255) * (hi - lo)
}

export function serializeSnapshot(s: SpectralSnapshot): SerializedSnapshot {
  const floorDb = DEFAULT_MAG_FLOOR_DB
  const binCount = s.binCount
  const mag = new Uint8Array(binCount)
  for (let i = 0; i < binCount; i++) {
    // gainToDb floors at floorDb so quantizeByte's lower clamp is rarely hit,
    // but we still clamp defensively in case magnitude is negative/NaN.
    const db = gainToDb(s.magnitude[i] ?? 0, floorDb)
    mag[i] = quantizeByte(db, floorDb, 0)
  }

  const out: SerializedSnapshot = {
    v: SNAPSHOT_SCHEMA_VERSION,
    fftSize: s.fftSize,
    sr: s.analysisSampleRate,
    f0: Number.isFinite(s.baseFrequency) ? s.baseFrequency : 0,
    mag: bytesToBase64Url(mag),
    magFloorDb: floorDb,
    label: typeof s.sourceLabel === 'string' ? s.sourceLabel : '',
    at: Number.isFinite(s.capturedAt) ? s.capturedAt : 0,
    live: Boolean(s.isLiveDerived),
  }

  if (s.phase) {
    const phase = new Uint8Array(binCount)
    for (let i = 0; i < binCount; i++) {
      phase[i] = quantizeByte(s.phase[i] ?? 0, PHASE_MIN, PHASE_MAX)
    }
    out.phase = bytesToBase64Url(phase)
  }

  return out
}

export function deserializeSnapshot(s: SerializedSnapshot): SpectralSnapshot {
  if (s == null || typeof s !== 'object') {
    throw new Error('deserializeSnapshot: not an object')
  }
  if (s.v !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`deserializeSnapshot: unsupported version ${String(s.v)}`)
  }

  const fftSize = s.fftSize
  if (!Number.isInteger(fftSize) || !isPow2(fftSize)) {
    throw new Error(`deserializeSnapshot: fftSize not a power of two (${String(fftSize)})`)
  }
  // Bound BEFORE deriving binCount / allocating anything.
  if (fftSize < MIN_FFT_SIZE || fftSize > MAX_FFT_SIZE) {
    throw new Error(`deserializeSnapshot: fftSize ${fftSize} out of [${MIN_FFT_SIZE}, ${MAX_FFT_SIZE}]`)
  }
  const binCount = fftSize / 2 + 1

  const sr = s.sr
  if (!Number.isFinite(sr) || sr <= 0) {
    throw new Error('deserializeSnapshot: invalid sample rate')
  }
  const floorDb = s.magFloorDb
  if (!Number.isFinite(floorDb) || floorDb >= 0) {
    throw new Error('deserializeSnapshot: invalid magFloorDb')
  }

  // Decode magnitude bytes; base64UrlToBytes refuses to allocate more than the
  // expected byte count, and we re-check the exact length here.
  const magBytes = base64UrlToBytes(s.mag, binCount)
  if (magBytes.length !== binCount) {
    throw new Error(
      `deserializeSnapshot: magnitude length ${magBytes.length} !== binCount ${binCount}`,
    )
  }

  let phase: Float32Array | null = null
  if (s.phase !== undefined) {
    if (typeof s.phase !== 'string') {
      throw new Error('deserializeSnapshot: phase is not a string')
    }
    const phaseBytes = base64UrlToBytes(s.phase, binCount)
    if (phaseBytes.length !== binCount) {
      throw new Error(
        `deserializeSnapshot: phase length ${phaseBytes.length} !== binCount ${binCount}`,
      )
    }
    phase = new Float32Array(binCount)
    for (let i = 0; i < binCount; i++) {
      phase[i] = dequantizeByte(phaseBytes[i], PHASE_MIN, PHASE_MAX)
    }
  }

  const magnitude = new Float32Array(binCount)
  for (let i = 0; i < binCount; i++) {
    const db = dequantizeByte(magBytes[i], floorDb, 0)
    // A byte of 0 maps exactly to floorDb; treat that as silence so a fully
    // floored bin round-trips to a clean 0 rather than a tiny -100 dB gain.
    magnitude[i] = magBytes[i] === 0 ? 0 : dbToGain(db)
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: sr,
    baseFrequency: Number.isFinite(s.f0) ? s.f0 : 0,
    magnitude,
    phase,
    sourceLabel: typeof s.label === 'string' ? s.label : '',
    capturedAt: Number.isFinite(s.at) ? s.at : 0,
    isLiveDerived: Boolean(s.live),
  }
}

export { PHASE_RANGE }
