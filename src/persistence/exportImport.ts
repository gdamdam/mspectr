/**
 * Human-portable JSON export / import of a single instrument, with its A/B
 * snapshots inlined (quantized) so the file is self-contained — unlike the
 * IndexedDB layout where snapshots live in a separate store and are referenced
 * by id.
 *
 * exportInstrumentJson is pure and deterministic (no Date.now / Math.random).
 * importInstrumentJson is a SECURITY BOUNDARY: it throws on malformed JSON or an
 * envelope that fails validation, and every nested value is sanitized — the
 * patch through sanitizePatch, each snapshot through deserializeSnapshot (which
 * bounds allocation by MAX_FFT_SIZE). A bad embedded snapshot drops to null
 * rather than failing the whole import, because the instrument is still useful
 * without it.
 */
import {
  INSTRUMENT_SCHEMA_VERSION,
  sanitizePatch,
  type SavedInstrument,
  type SerializedSnapshot,
  type SpectralSnapshot,
} from '../audio/contracts'
import { deserializeInstrument } from './instruments'
import { deserializeSnapshot, serializeSnapshot } from '../sharing/snapshotCodec'

/** Bumped independently of the per-record schema versions. */
export const EXPORT_SCHEMA_VERSION = 1
const EXPORT_KIND = 'mspectr-instrument'

interface ExportEnvelope {
  kind: typeof EXPORT_KIND
  exportVersion: number
  instrument: SavedInstrument
  snapA: SerializedSnapshot | null
  snapB: SerializedSnapshot | null
}

export function exportInstrumentJson(
  inst: SavedInstrument,
  snapA: SpectralSnapshot | null,
  snapB: SpectralSnapshot | null,
): string {
  const envelope: ExportEnvelope = {
    kind: EXPORT_KIND,
    exportVersion: EXPORT_SCHEMA_VERSION,
    // Sanitize the patch on the way out so an exported file is trustworthy.
    instrument: {
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      id: inst.id,
      name: inst.name,
      createdAt: Number.isFinite(inst.createdAt) ? inst.createdAt : 0,
      updatedAt: Number.isFinite(inst.updatedAt) ? inst.updatedAt : 0,
      patch: sanitizePatch(inst.patch),
      snapshotRefA: inst.snapshotRefA,
      snapshotRefB: inst.snapshotRefB,
      sourceLabel: typeof inst.sourceLabel === 'string' ? inst.sourceLabel : '',
    },
    snapA: snapA ? serializeSnapshot(snapA) : null,
    snapB: snapB ? serializeSnapshot(snapB) : null,
  }
  return JSON.stringify(envelope)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decode an embedded snapshot, dropping to null if it fails validation. */
function importSnapshot(raw: unknown): SpectralSnapshot | null {
  if (!isRecord(raw)) return null
  try {
    return deserializeSnapshot(raw as unknown as SerializedSnapshot)
  } catch {
    return null
  }
}

export function importInstrumentJson(json: string): {
  instrument: SavedInstrument
  snapA: SpectralSnapshot | null
  snapB: SpectralSnapshot | null
} {
  if (typeof json !== 'string') {
    throw new Error('importInstrumentJson: input is not a string')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('importInstrumentJson: malformed JSON')
  }
  if (!isRecord(parsed)) {
    throw new Error('importInstrumentJson: top-level value is not an object')
  }
  if (parsed.kind !== EXPORT_KIND) {
    throw new Error('importInstrumentJson: unrecognized export kind')
  }
  if (!isRecord(parsed.instrument)) {
    throw new Error('importInstrumentJson: missing instrument record')
  }

  const instrumentRecord = parsed.instrument
  // The id may be absent/blank in a hand-edited file; fall back to a stable
  // placeholder rather than throwing — the caller assigns a real id on save.
  const id =
    typeof instrumentRecord.id === 'string' && instrumentRecord.id.length > 0
      ? instrumentRecord.id
      : 'imported'
  const instrument = deserializeInstrument(instrumentRecord, id)

  return {
    instrument,
    snapA: importSnapshot(parsed.snapA),
    snapB: importSnapshot(parsed.snapB),
  }
}
