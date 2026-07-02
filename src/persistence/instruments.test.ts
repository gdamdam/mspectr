import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PATCH,
  INSTRUMENT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  type SavedInstrument,
  type SpectralSnapshot,
} from '../audio/contracts'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock.
//
// fake-indexeddb is not installed, so we implement just enough of the IDB
// surface that db.ts uses: open + onupgradeneeded/onsuccess, createObjectStore,
// objectStoreNames.contains, transaction → objectStore → put/get/getAll/
// getAllKeys/delete returning request objects whose onsuccess fires
// asynchronously, plus db.close(). Requests resolve on a microtask so the
// promise wiring in withStore is exercised realistically.
// ---------------------------------------------------------------------------

type Key = string

class FakeRequest<T> {
  result: T | undefined
  error: unknown = null
  readyState: IDBRequestReadyState = 'pending'
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  _succeed(value: T) {
    this.result = value
    this.readyState = 'done'
  }
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<Key, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}
  private finish<T>(req: FakeRequest<T>, value: T) {
    this.transaction.beginRequest()
    queueMicrotask(() => {
      req._succeed(value)
      req.onsuccess?.()
      this.transaction.endRequest()
    })
    return req
  }
  put(value: unknown, key: Key) {
    const req = new FakeRequest<undefined>()
    this.data.set(key, structuredClone(value))
    return this.finish(req, undefined)
  }
  get(key: Key) {
    const req = new FakeRequest<unknown>()
    const v = this.data.has(key) ? structuredClone(this.data.get(key)) : undefined
    return this.finish(req, v)
  }
  getAll() {
    const req = new FakeRequest<unknown[]>()
    return this.finish(req, Array.from(this.data.values()).map((v) => structuredClone(v)))
  }
  getAllKeys() {
    const req = new FakeRequest<Key[]>()
    return this.finish(req, Array.from(this.data.keys()))
  }
  delete(key: Key) {
    const req = new FakeRequest<undefined>()
    this.data.delete(key)
    return this.finish(req, undefined)
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  error: unknown = null
  private pending = 0
  constructor(private readonly stores: Map<string, Map<Key, unknown>>) {}
  objectStore(name: string) {
    const map = this.stores.get(name)
    if (!map) throw new Error(`unknown store ${name}`)
    return new FakeObjectStore(map, this)
  }
  beginRequest() {
    this.pending++
  }
  endRequest() {
    this.pending--
    if (this.pending === 0) queueMicrotask(() => this.oncomplete?.())
  }
  abort() {
    this.onabort?.()
  }
}

class FakeDatabase {
  stores = new Map<string, Map<Key, unknown>>()
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  }
  createObjectStore(name: string) {
    this.stores.set(name, new Map())
  }
  transaction(_name: string | string[], _mode: string) {
    return new FakeTransaction(this.stores)
  }
  close() {
    /* no-op for the mock */
  }
}

class FakeOpenRequest {
  result: FakeDatabase
  error: unknown = null
  onupgradeneeded: (() => void) | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onblocked: (() => void) | null = null
  constructor(db: FakeDatabase, fresh: boolean) {
    this.result = db
    queueMicrotask(() => {
      if (fresh) this.onupgradeneeded?.()
      this.onsuccess?.()
    })
  }
}

class FakeIDBFactory {
  private db: FakeDatabase | null = null
  open(_name: string, _version?: number) {
    const fresh = this.db === null
    if (fresh) this.db = new FakeDatabase()
    return new FakeOpenRequest(this.db as FakeDatabase, fresh)
  }
}

// Import AFTER defining the mock; instruments.ts reads the global indexedDB
// lazily inside openDb, so installing it in beforeEach is sufficient.
import {
  deleteInstrument,
  duplicateInstrument,
  listInstruments,
  loadInstrument,
  renameInstrument,
  saveInstrumentBundle,
  saveInstrument,
  pruneOrphanSnapshots,
} from './instruments'
import { getSnapshot, putSnapshot } from './snapshots'

const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new FakeIDBFactory()
})

afterEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB
})

function makeInstrument(id: string, overrides: Partial<SavedInstrument> = {}): SavedInstrument {
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    id,
    name: `Instrument ${id}`,
    createdAt: 10,
    updatedAt: 10,
    patch: { ...DEFAULT_PATCH },
    snapshotRefA: null,
    snapshotRefB: null,
    sourceLabel: '',
    ...overrides,
  }
}

function makeSnapshot(): SpectralSnapshot {
  const fftSize = 512
  const binCount = fftSize / 2 + 1
  const magnitude = new Float32Array(binCount)
  for (let i = 0; i < binCount; i++) magnitude[i] = dbToGain(-40 + 20 * Math.cos(i / 5))
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 220,
    frameCount: 1,
    frameHop: fftSize / 4,
    magnitude,
    phase: null,
    sourceLabel: 'src',
    capturedAt: 42,
    isLiveDerived: false,
  }
}

describe('instruments CRUD (in-memory IDB)', () => {
  it('saves and loads an instrument', async () => {
    await saveInstrument(makeInstrument('a', { patch: { ...DEFAULT_PATCH, seed: 77 } }))
    const loaded = await loadInstrument('a')
    expect(loaded).not.toBeNull()
    expect(loaded?.id).toBe('a')
    expect(loaded?.patch.seed).toBe(77)
  })

  it('returns null for a missing instrument', async () => {
    expect(await loadInstrument('nope')).toBeNull()
  })

  it('lists all saved instruments with correct ids', async () => {
    await saveInstrument(makeInstrument('a'))
    await saveInstrument(makeInstrument('b'))
    const all = await listInstruments()
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  it('deletes an instrument', async () => {
    await saveInstrument(makeInstrument('a'))
    await deleteInstrument('a')
    expect(await loadInstrument('a')).toBeNull()
  })

  it('renames an instrument and rejects renaming a missing one', async () => {
    await saveInstrument(makeInstrument('a'))
    await renameInstrument('a', '  Fresh Name  ')
    expect((await loadInstrument('a'))?.name).toBe('Fresh Name')
    await expect(renameInstrument('missing', 'x')).rejects.toThrow()
  })

  it('duplicates an instrument under a new id with caller timestamp', async () => {
    await saveInstrument(makeInstrument('a', { name: 'Orig' }))
    const dup = await duplicateInstrument('a', 'a-copy', 555)
    expect(dup).not.toBeNull()
    expect(dup?.id).toBe('a-copy')
    expect(dup?.name).toBe('Orig copy')
    expect(dup?.createdAt).toBe(555)
    expect(dup?.updatedAt).toBe(555)
    // Both exist independently.
    expect(await loadInstrument('a')).not.toBeNull()
    expect((await loadInstrument('a-copy'))?.name).toBe('Orig copy')
  })

  it('duplicate of a missing instrument returns null', async () => {
    expect(await duplicateInstrument('ghost', 'g2', 1)).toBeNull()
  })

  it('sanitizes a tampered patch on read', async () => {
    // Save directly through the mock with an out-of-range patch, then load.
    const tampered = makeInstrument('t')
    ;(tampered.patch as { polyphony: number }).polyphony = 9999
    await saveInstrument(tampered)
    const loaded = await loadInstrument('t')
    expect(loaded?.patch.polyphony).toBeLessThanOrEqual(8)
  })

  it('rejects saving with an empty id', async () => {
    await expect(saveInstrument(makeInstrument(''))).rejects.toThrow(/id/)
  })
})

describe('deleteInstrument cascades to owned snapshots', () => {
  it('removes the snapshots the deleted instrument owns', async () => {
    await putSnapshot('a:A', makeSnapshot())
    await putSnapshot('a:B', makeSnapshot())
    await saveInstrument(makeInstrument('a', { snapshotRefA: 'a:A', snapshotRefB: 'a:B' }))
    await deleteInstrument('a')
    expect(await loadInstrument('a')).toBeNull()
    expect(await getSnapshot('a:A')).toBeNull()
    expect(await getSnapshot('a:B')).toBeNull()
  })

  it('keeps a snapshot another instrument (a duplicate) still references', async () => {
    await putSnapshot('a:A', makeSnapshot())
    await saveInstrument(makeInstrument('a', { snapshotRefA: 'a:A' }))
    // A duplicate shares the source's ref; deleting the source must not strip it.
    await saveInstrument(makeInstrument('a-copy', { snapshotRefA: 'a:A' }))
    await deleteInstrument('a')
    expect(await getSnapshot('a:A')).not.toBeNull()
  })
})

describe('atomic session bundles and orphan pruning', () => {
  it('saves an instrument and its owned snapshots together', async () => {
    const snap = makeSnapshot()
    await saveInstrumentBundle(
      makeInstrument('bundle', { snapshotRefA: 'bundle:A' }),
      snap,
      null,
    )
    expect(await loadInstrument('bundle')).not.toBeNull()
    expect(await getSnapshot('bundle:A')).not.toBeNull()
  })

  it('removes only snapshots not referenced by an instrument', async () => {
    await putSnapshot('kept', makeSnapshot())
    await putSnapshot('orphan', makeSnapshot())
    await saveInstrument(makeInstrument('a', { snapshotRefA: 'kept' }))
    expect(await pruneOrphanSnapshots()).toBe(1)
    expect(await getSnapshot('kept')).not.toBeNull()
    expect(await getSnapshot('orphan')).toBeNull()
  })
})

describe('graceful degradation', () => {
  it('rejects with a clear error when IndexedDB is absent', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = undefined
    await expect(loadInstrument('a')).rejects.toThrow(/IndexedDB is not available/)
  })
})
