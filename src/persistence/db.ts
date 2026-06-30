/**
 * IndexedDB access for mspectr persistence.
 *
 * Single database `mspectr` with two object stores keyed by id:
 *   - `instruments`  — SavedInstrument records (patch + metadata + snapshot refs)
 *   - `snapshots`    — serialized spectral snapshots, referenced from instruments
 *
 * Defensive open / transaction helpers adapted from mgrains
 * (mgrains/src/storage/presets.ts PresetStore): IndexedDB is unavailable in the
 * node test environment and in privacy modes, so open() rejects with a clear
 * Error rather than throwing synchronously, and callers degrade gracefully.
 */

export const DB_NAME = 'mspectr'
export const DB_VERSION = 1
export const INSTRUMENTS_STORE = 'instruments'
export const SNAPSHOTS_STORE = 'snapshots'

/**
 * Open (and, on first use or version bump, upgrade) the mspectr database.
 * Rejects with a clear Error when IndexedDB is absent so callers can fall back
 * to an in-memory / no-persistence mode instead of crashing.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('mspectr persistence: IndexedDB is not available in this environment'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      // Some privacy modes throw synchronously from open().
      reject(err instanceof Error ? err : new Error('mspectr persistence: failed to open IndexedDB'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(INSTRUMENTS_STORE)) {
        db.createObjectStore(INSTRUMENTS_STORE)
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('mspectr persistence: failed to open IndexedDB'))
    request.onblocked = () =>
      reject(new Error('mspectr persistence: IndexedDB open blocked by another connection'))
  })
}

/**
 * Run a single request against one store inside its own transaction, resolving
 * with the request result. The db connection is closed when done so we never
 * leak handles. Adapted from mgrains PresetStore.tx.
 */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)
      const request = run(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error('mspectr persistence: IndexedDB request failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('mspectr persistence: IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}
