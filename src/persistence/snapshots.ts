/**
 * Snapshot storage over the `snapshots` object store.
 *
 * Snapshots are persisted in their quantized wire form (SerializedSnapshot) via
 * the sharing codec, so what lands in IndexedDB is the same compact, validated
 * shape used for sharing. getSnapshot runs the snapshot back through
 * deserializeSnapshot, which is the security boundary: a tampered record (bad
 * version, oversized fftSize, truncated bytes) throws rather than allocating an
 * unbounded buffer.
 */
import type { SpectralSnapshot } from '../audio/contracts'
import { deserializeSnapshot, serializeSnapshot } from '../sharing/snapshotCodec'
import { SNAPSHOTS_STORE, withStore } from './db'

export async function putSnapshot(id: string, snap: SpectralSnapshot): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('putSnapshot: id must be a non-empty string')
  }
  const serialized = serializeSnapshot(snap)
  await withStore(SNAPSHOTS_STORE, 'readwrite', (store) => store.put(serialized, id))
}

export async function getSnapshot(id: string): Promise<SpectralSnapshot | null> {
  const raw = await withStore<unknown>(SNAPSHOTS_STORE, 'readonly', (store) => store.get(id))
  if (raw === undefined) return null
  // deserializeSnapshot validates and throws on malformed data; a corrupt
  // record surfaces as a rejected promise rather than poisoning the engine.
  return deserializeSnapshot(raw as ReturnType<typeof serializeSnapshot>)
}

export async function deleteSnapshot(id: string): Promise<void> {
  await withStore(SNAPSHOTS_STORE, 'readwrite', (store) => store.delete(id))
}
