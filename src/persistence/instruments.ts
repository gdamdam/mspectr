/**
 * SavedInstrument CRUD over the `instruments` object store.
 *
 * Reads are defensive: every record that comes back out of IndexedDB is rebuilt
 * through deserializeInstrument (which runs sanitizePatch), so a tampered or
 * stale-schema record can never reach the engine with out-of-range data — the
 * same boundary mgrains applies in deserializePreset.
 *
 * Timestamps are supplied by callers (e.g. duplicateInstrument's `now`) rather
 * than read from Date.now here, keeping persistence deterministic for tests.
 */
import {
  INSTRUMENT_SCHEMA_VERSION,
  sanitizePatch,
  type SavedInstrument,
} from '../audio/contracts'
import { INSTRUMENTS_STORE, withStore } from './db'
import { deleteSnapshot } from './snapshots'

const DEFAULT_INSTRUMENT_NAME = 'Untitled'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_INSTRUMENT_NAME
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_INSTRUMENT_NAME
}

function coerceRef(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Rebuild a SavedInstrument from an unknown record. Never throws: missing/bad
 * fields fall back to safe defaults and the patch is migrated through
 * sanitizePatch. `id` is the store key, passed in so a record whose body lacks
 * (or disagrees about) its id still resolves to the key it was stored under.
 */
export function deserializeInstrument(raw: unknown, id: string): SavedInstrument {
  const r = isRecord(raw) ? raw : {}
  const createdAt = finiteOr(r.createdAt, 0)
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    id,
    name: coerceName(r.name),
    createdAt,
    // Default updatedAt to createdAt rather than 0 so a record missing it still
    // sorts sensibly.
    updatedAt: finiteOr(r.updatedAt, createdAt),
    patch: sanitizePatch(r.patch),
    snapshotRefA: coerceRef(r.snapshotRefA),
    snapshotRefB: coerceRef(r.snapshotRefB),
    sourceLabel: typeof r.sourceLabel === 'string' ? r.sourceLabel : '',
  }
}

/** Own a sanitized copy before persisting so we never alias caller data. */
function serializeInstrument(inst: SavedInstrument): SavedInstrument {
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    id: inst.id,
    name: coerceName(inst.name),
    createdAt: finiteOr(inst.createdAt, 0),
    updatedAt: finiteOr(inst.updatedAt, finiteOr(inst.createdAt, 0)),
    patch: sanitizePatch(inst.patch),
    snapshotRefA: coerceRef(inst.snapshotRefA),
    snapshotRefB: coerceRef(inst.snapshotRefB),
    sourceLabel: typeof inst.sourceLabel === 'string' ? inst.sourceLabel : '',
  }
}

export async function saveInstrument(inst: SavedInstrument): Promise<void> {
  if (typeof inst.id !== 'string' || inst.id.length === 0) {
    throw new Error('saveInstrument: instrument id must be a non-empty string')
  }
  const record = serializeInstrument(inst)
  await withStore(INSTRUMENTS_STORE, 'readwrite', (store) => store.put(record, record.id))
}

export async function listInstruments(): Promise<SavedInstrument[]> {
  // getAllKeys + getAll keep key alignment so deserialize gets the right id.
  const keys = await withStore<IDBValidKey[]>(INSTRUMENTS_STORE, 'readonly', (store) =>
    store.getAllKeys(),
  )
  const values = await withStore<unknown[]>(INSTRUMENTS_STORE, 'readonly', (store) =>
    store.getAll(),
  )
  const out: SavedInstrument[] = []
  for (let i = 0; i < values.length; i++) {
    const id = typeof keys[i] === 'string' ? (keys[i] as string) : String(keys[i])
    out.push(deserializeInstrument(values[i], id))
  }
  return out
}

export async function loadInstrument(id: string): Promise<SavedInstrument | null> {
  const raw = await withStore<unknown>(INSTRUMENTS_STORE, 'readonly', (store) => store.get(id))
  return raw === undefined ? null : deserializeInstrument(raw, id)
}

export async function deleteInstrument(id: string): Promise<void> {
  // Read the record first so we can cascade-delete the snapshots it owns — a
  // bare instrument delete would orphan those spectra in the snapshots store.
  const inst = await loadInstrument(id)
  await withStore(INSTRUMENTS_STORE, 'readwrite', (store) => store.delete(id))
  if (!inst) return
  const refs = [inst.snapshotRefA, inst.snapshotRefB].filter((r): r is string => r !== null)
  if (refs.length === 0) return
  // A duplicated instrument shares its source's snapshot refs (see
  // duplicateInstrument), so only drop a snapshot that no surviving instrument
  // still references — otherwise deleting one would strip a spectrum in use.
  const survivors = await listInstruments()
  const stillReferenced = new Set<string>()
  for (const s of survivors) {
    if (s.snapshotRefA) stillReferenced.add(s.snapshotRefA)
    if (s.snapshotRefB) stillReferenced.add(s.snapshotRefB)
  }
  for (const ref of refs) {
    if (!stillReferenced.has(ref)) await deleteSnapshot(ref)
  }
}

export async function renameInstrument(id: string, name: string): Promise<void> {
  const existing = await loadInstrument(id)
  if (existing === null) {
    throw new Error(`renameInstrument: no instrument with id "${id}"`)
  }
  await saveInstrument({ ...existing, name: coerceName(name) })
}

/**
 * Copy an instrument under a new id. The duplicate shares the original's
 * snapshot refs (snapshots are content stored separately and immutable), gets
 * a " copy" suffix, and stamps createdAt/updatedAt with the caller-supplied
 * `now`. Returns the new instrument, or null if the source is missing.
 */
export async function duplicateInstrument(
  id: string,
  newId: string,
  now: number,
): Promise<SavedInstrument | null> {
  if (typeof newId !== 'string' || newId.length === 0) {
    throw new Error('duplicateInstrument: newId must be a non-empty string')
  }
  const source = await loadInstrument(id)
  if (source === null) return null
  const copy: SavedInstrument = {
    ...source,
    id: newId,
    name: `${source.name} copy`,
    createdAt: finiteOr(now, source.createdAt),
    updatedAt: finiteOr(now, source.updatedAt),
  }
  await saveInstrument(copy)
  return copy
}
