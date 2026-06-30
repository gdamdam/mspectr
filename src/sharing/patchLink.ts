/**
 * Shareable link codecs.
 *
 *  - encodePatchLink / decodePatchLink: patch-only. base64url(JSON(sanitized
 *    patch)). Small, deterministic, always safe — decode runs sanitizePatch so
 *    a hostile fragment can only ever yield an in-range patch (or null).
 *
 *  - encodeSnapshotLink / decodeSnapshotLink: patch plus optional A/B
 *    snapshots, each quantized through snapshotCodec. Bounded by
 *    MAX_SNAPSHOT_LINK_BYTES so the UI can refuse to produce a URL that no
 *    browser would accept. estimateSnapshotLinkBytes returns the exact encoded
 *    length so the UI can show the size before the user copies.
 *
 * isLiveDerived survives the round trip (the UI gates consent on it).
 *
 * decode functions are a SECURITY BOUNDARY: they never throw. Any malformed,
 * oversized, or out-of-range input returns null. All snapshot validation is
 * delegated to deserializeSnapshot, which bounds allocation by MAX_FFT_SIZE.
 */
import { sanitizePatch, type SerializedSnapshot, type SpectralPatch, type SpectralSnapshot } from '../audio/contracts'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deserializeSnapshot,
  serializeSnapshot,
} from './snapshotCodec'

/**
 * Hard ceiling on the encoded snapshot-link length. Real browsers accept far
 * longer URLs, but a spectral snapshot embedded in a fragment gets unwieldy
 * fast; 16 KB keeps links pasteable and bounds decode work.
 */
export const MAX_SNAPSHOT_LINK_BYTES = 16000

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

/** UTF-8 string → base64url. */
function stringToBase64Url(text: string): string {
  const bytes = textEncoder
    ? textEncoder.encode(text)
    : new Uint8Array(Buffer.from(text, 'utf-8'))
  return bytesToBase64Url(bytes)
}

/** base64url → UTF-8 string. Throws on malformed base64. */
function base64UrlToString(fragment: string): string {
  const bytes = base64UrlToBytes(fragment)
  if (textDecoder) return textDecoder.decode(bytes)
  return Buffer.from(bytes).toString('utf-8')
}

// ---------------------------------------------------------------------------
// Patch-only links
// ---------------------------------------------------------------------------

export function encodePatchLink(patch: SpectralPatch): string {
  // Sanitize on the way out too: the encoded link only ever carries in-range
  // data, so a copied link is trustworthy regardless of caller state.
  const safe = sanitizePatch(patch)
  return stringToBase64Url(JSON.stringify(safe))
}

export function decodePatchLink(fragment: string): SpectralPatch | null {
  if (typeof fragment !== 'string' || fragment.length === 0) return null
  try {
    const json = base64UrlToString(fragment)
    const parsed: unknown = JSON.parse(json)
    if (parsed == null || typeof parsed !== 'object') return null
    return sanitizePatch(parsed)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Snapshot links (patch + optional A/B)
// ---------------------------------------------------------------------------

interface SnapshotLinkPayload {
  /** Patch is stored sanitized. */
  p: SpectralPatch
  a?: SerializedSnapshot
  b?: SerializedSnapshot
}

function buildPayload(
  patch: SpectralPatch,
  a: SpectralSnapshot | null,
  b: SpectralSnapshot | null,
): SnapshotLinkPayload {
  const payload: SnapshotLinkPayload = { p: sanitizePatch(patch) }
  if (a) payload.a = serializeSnapshot(a)
  if (b) payload.b = serializeSnapshot(b)
  return payload
}

export function encodeSnapshotLink(
  patch: SpectralPatch,
  a: SpectralSnapshot | null,
  b: SpectralSnapshot | null,
): string {
  return stringToBase64Url(JSON.stringify(buildPayload(patch, a, b)))
}

/**
 * Exact encoded length the corresponding encodeSnapshotLink would produce, so
 * the UI can display size and gate on MAX_SNAPSHOT_LINK_BYTES before copying.
 */
export function estimateSnapshotLinkBytes(
  patch: SpectralPatch,
  a: SpectralSnapshot | null,
  b: SpectralSnapshot | null,
): number {
  return encodeSnapshotLink(patch, a, b).length
}

export function decodeSnapshotLink(
  fragment: string,
): { patch: SpectralPatch; a: SpectralSnapshot | null; b: SpectralSnapshot | null } | null {
  if (typeof fragment !== 'string' || fragment.length === 0) return null
  // Reject oversized fragments before decoding/parsing anything.
  if (fragment.length > MAX_SNAPSHOT_LINK_BYTES) return null
  try {
    const json = base64UrlToString(fragment)
    const parsed = JSON.parse(json) as Partial<SnapshotLinkPayload> | null
    if (parsed == null || typeof parsed !== 'object') return null
    const patch = sanitizePatch(parsed.p)
    // deserializeSnapshot throws on any violation; the surrounding try returns
    // null so a single bad snapshot fails the whole link cleanly.
    const a = parsed.a !== undefined ? deserializeSnapshot(parsed.a) : null
    const b = parsed.b !== undefined ? deserializeSnapshot(parsed.b) : null
    return { patch, a, b }
  } catch {
    return null
  }
}
