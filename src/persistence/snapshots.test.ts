import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOT_FRAMES,
  SNAPSHOT_SCHEMA_VERSION,
  dbToGain,
  type SerializedSnapshot,
  type SpectralSnapshot,
} from '../audio/contracts'
import { serializeSnapshot } from '../sharing/snapshotCodec'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock, matching instruments.test.ts. db.ts reads
// the global indexedDB lazily inside openDb, so installing it in beforeEach is
// sufficient. Only the surface snapshots.ts exercises (put/get/delete) is
// implemented; requests resolve on a microtask so the promise wiring is real.
// ---------------------------------------------------------------------------

type Key = string

class FakeRequest<T> {
  result: T | undefined
  error: unknown = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  _succeed(value: T) {
    this.result = value
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
  /** Test-only: reach into the raw snapshots store to plant tampered rows. */
  _rawStore(name: string): Map<Key, unknown> {
    if (!this.db) this.db = new FakeDatabase()
    if (!this.db.stores.has(name)) this.db.createObjectStore(name)
    return this.db.stores.get(name) as Map<Key, unknown>
  }
}

// Import AFTER defining the mock.
import { deleteSnapshot, getSnapshot, putSnapshot } from './snapshots'
import { SNAPSHOTS_STORE } from './db'

const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB
let factory: FakeIDBFactory

beforeEach(() => {
  factory = new FakeIDBFactory()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = factory
})

afterEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB
})

function makeSnapshot(fftSize: number, frameCount = 1): SpectralSnapshot {
  const binCount = fftSize / 2 + 1
  const total = frameCount * binCount
  const magnitude = new Float32Array(total)
  for (let f = 0; f < frameCount; f++) {
    for (let i = 0; i < binCount; i++) {
      magnitude[f * binCount + i] = dbToGain(-55 + 35 * Math.cos((i + f * 4) / 6))
    }
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 220,
    frameCount,
    frameHop: fftSize / 4,
    magnitude,
    phase: null,
    sourceLabel: 'src',
    capturedAt: 42,
    isLiveDerived: true,
  }
}

describe('snapshot persistence (in-memory IDB)', () => {
  it('stores and reads a static (single-frame) snapshot', async () => {
    await putSnapshot('s', makeSnapshot(2048, 1))
    const back = await getSnapshot('s')
    expect(back).not.toBeNull()
    expect(back?.frameCount).toBe(1)
    expect(back?.fftSize).toBe(2048)
    expect(back?.isLiveDerived).toBe(true)
  })

  it('stores and reads a multi-frame snapshot', async () => {
    await putSnapshot('m', makeSnapshot(1024, 8))
    const back = await getSnapshot('m')
    expect(back?.frameCount).toBe(8)
    expect(back?.frameHop).toBe(1024 / 4)
    expect(back?.magnitude.length).toBe(8 * (1024 / 2 + 1))
  })

  it('returns null for a missing snapshot', async () => {
    expect(await getSnapshot('nope')).toBeNull()
  })

  it('deletes a snapshot', async () => {
    await putSnapshot('s', makeSnapshot(512, 1))
    await deleteSnapshot('s')
    expect(await getSnapshot('s')).toBeNull()
  })

  it('rejects an empty id on write', async () => {
    await expect(putSnapshot('', makeSnapshot(512, 1))).rejects.toThrow(/id/)
  })

  it('migrates a v1 row (no frames field) on read', async () => {
    // Plant a raw v1 serialized snapshot directly, as an old persisted row.
    const ser = serializeSnapshot(makeSnapshot(1024, 1))
    const { frames: _frames, frameHop: _frameHop, ...rest } = ser
    const v1Row = { ...rest, v: 1 } as unknown as SerializedSnapshot
    factory._rawStore(SNAPSHOTS_STORE).set('legacy', v1Row)

    const back = await getSnapshot('legacy')
    expect(back?.frameCount).toBe(1)
    expect(back?.frameHop).toBe(1024 / 4)
    expect(back?.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
  })

  it('re-validates on read: a tampered oversized frame count throws', async () => {
    const ser = serializeSnapshot(makeSnapshot(1024, 1))
    // Claim more frames than the payload holds and beyond the hard bound.
    const bad = { ...ser, frames: MAX_SNAPSHOT_FRAMES + 1 } as SerializedSnapshot
    factory._rawStore(SNAPSHOTS_STORE).set('bad', bad)
    await expect(getSnapshot('bad')).rejects.toThrow()
  })
})
