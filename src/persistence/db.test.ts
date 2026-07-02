import { afterEach, describe, expect, it, vi } from 'vitest'
import { INSTRUMENTS_STORE, withStore } from './db'

const originalIndexedDB = globalThis.indexedDB

afterEach(() => {
  vi.unstubAllGlobals()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = originalIndexedDB
})

describe('IndexedDB transaction completion', () => {
  it('rejects a quota abort that happens after the request reports success', async () => {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest
    const quota = new DOMException('quota exceeded', 'QuotaExceededError')
    const transaction = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => ({
        put: () => {
          queueMicrotask(() => {
            ;(request.onsuccess as ((this: IDBRequest, ev: Event) => unknown) | null)?.call(request, new Event('success'))
            ;(transaction as { error: DOMException | null }).error = quota
            transaction.onabort?.call(transaction as unknown as IDBTransaction, new Event('abort'))
          })
          return request
        },
      }),
    } as unknown as IDBTransaction
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => transaction,
      close: vi.fn(),
    } as unknown as IDBDatabase
    const openRequest = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      onupgradeneeded: null,
    } as unknown as IDBOpenDBRequest
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success')))
        return openRequest
      },
    })

    await expect(
      withStore(INSTRUMENTS_STORE, 'readwrite', (store) => store.put({ id: 'x' }, 'x')),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' })
  })
})
