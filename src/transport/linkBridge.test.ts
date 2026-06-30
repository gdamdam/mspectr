import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLinkBridge, sanitizeLinkMessage } from './linkBridge'
import type { LinkState } from './linkBridge'

const DEFAULT: LinkState = {
  tempo: 120,
  beat: 0,
  phase: 0,
  playing: false,
  peers: 0,
  clients: 0,
  connected: false,
}

// ---------------------------------------------------------------------------
// sanitizeLinkMessage — defence against malformed bridge messages.
// ---------------------------------------------------------------------------

describe('sanitizeLinkMessage', () => {
  const base: LinkState = { ...DEFAULT, connected: true }

  it('passes through valid in-range values and sets connected', () => {
    const out = sanitizeLinkMessage(
      { tempo: 128, beat: 12.5, phase: 2.5, playing: true, peers: 3, clients: 2 },
      base,
    )
    expect(out).toEqual({
      tempo: 128,
      beat: 12.5,
      phase: 2.5,
      playing: true,
      peers: 3,
      clients: 2,
      connected: true,
    })
  })

  it('clamps tempo to 20..999', () => {
    expect(sanitizeLinkMessage({ tempo: 5 }, base).tempo).toBe(20)
    expect(sanitizeLinkMessage({ tempo: 5000 }, base).tempo).toBe(999)
  })

  it('clamps phase to 0..16 and beat to 0..1e9', () => {
    expect(sanitizeLinkMessage({ phase: -3 }, base).phase).toBe(0)
    expect(sanitizeLinkMessage({ phase: 99 }, base).phase).toBe(16)
    expect(sanitizeLinkMessage({ beat: -10 }, base).beat).toBe(0)
    expect(sanitizeLinkMessage({ beat: 1e12 }, base).beat).toBe(1e9)
  })

  it('floors peers/clients to non-negative ints', () => {
    const out = sanitizeLinkMessage({ peers: 3.9, clients: -2 }, base)
    expect(out.peers).toBe(3)
    expect(out.clients).toBe(0)
  })

  it('rejects NaN and Infinity, retaining previous values', () => {
    const prev: LinkState = { ...base, tempo: 130, beat: 4, phase: 1 }
    const out = sanitizeLinkMessage({ tempo: NaN, beat: Infinity, phase: -Infinity }, prev)
    expect(out.tempo).toBe(130)
    expect(out.beat).toBe(4)
    expect(out.phase).toBe(1)
  })

  it('rejects non-number types, retaining previous values', () => {
    const prev: LinkState = { ...base, tempo: 100, peers: 5 }
    const out = sanitizeLinkMessage({ tempo: '200', peers: null, playing: 'yes' }, prev)
    expect(out.tempo).toBe(100)
    expect(out.peers).toBe(5)
    expect(out.playing).toBe(false) // non-boolean rejected → prev
  })
})

// ---------------------------------------------------------------------------
// Mock WebSocket — controllable open/message/close/error + a throwing variant.
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1
  static instances: MockWebSocket[] = []
  static shouldThrow = false

  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  closed = false

  constructor(public url: string) {
    if (MockWebSocket.shouldThrow) throw new Error('WS blocked')
    MockWebSocket.instances.push(this)
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
  message(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  triggerClose(): void {
    this.onclose?.()
  }
  triggerError(): void {
    this.onerror?.()
  }
  close(): void {
    this.closed = true
  }
}

describe('createLinkBridge', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    MockWebSocket.shouldThrow = false
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts disconnected at default tempo 120', () => {
    const bridge = createLinkBridge()
    expect(bridge.getState()).toEqual(DEFAULT)
  })

  it('connect() opens the first loopback address and marks connected on open', () => {
    const bridge = createLinkBridge()
    bridge.connect()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://127.0.0.1:19876')

    const seen: LinkState[] = []
    bridge.subscribe((s) => seen.push(s))
    MockWebSocket.instances[0].open()
    expect(bridge.getState().connected).toBe(true)
    expect(seen.at(-1)?.connected).toBe(true)
  })

  it('subscribe notifies on sanitized link messages and unsubscribe stops it', () => {
    const bridge = createLinkBridge()
    bridge.connect()
    const ws = MockWebSocket.instances[0]
    ws.open()

    const seen: LinkState[] = []
    const unsub = bridge.subscribe((s) => seen.push(s))

    ws.message({ type: 'link', tempo: 140, beat: 2, phase: 1, peers: 2, playing: true })
    expect(bridge.getState().tempo).toBe(140)
    expect(bridge.getState().peers).toBe(2)
    expect(seen.at(-1)?.tempo).toBe(140)

    // Out-of-range message is clamped before notifying.
    ws.message({ type: 'link', tempo: 9999 })
    expect(bridge.getState().tempo).toBe(999)

    unsub()
    const countBefore = seen.length
    ws.message({ type: 'link', tempo: 130 })
    expect(seen.length).toBe(countBefore) // no further notifications
    expect(bridge.getState().tempo).toBe(130) // state still updates
  })

  it('ignores malformed JSON and non-link messages without throwing', () => {
    const bridge = createLinkBridge()
    bridge.connect()
    const ws = MockWebSocket.instances[0]
    ws.open()
    expect(() => ws.message('not json{')).not.toThrow()
    expect(() => ws.message({ type: 'other', tempo: 200 })).not.toThrow()
    expect(bridge.getState().tempo).toBe(120) // unchanged
  })

  it('tolerates a WebSocket constructor that throws (bridge absent)', () => {
    MockWebSocket.shouldThrow = true
    const bridge = createLinkBridge()
    expect(() => bridge.connect()).not.toThrow()
    expect(bridge.getState().connected).toBe(false)
    expect(bridge.getState().tempo).toBe(120)
  })

  it('tolerates a missing WebSocket global entirely', () => {
    vi.stubGlobal('WebSocket', undefined)
    const bridge = createLinkBridge()
    expect(() => bridge.connect()).not.toThrow()
    expect(bridge.getState().connected).toBe(false)
  })

  it('with autoRetry, schedules a reconnect after a drop', () => {
    const bridge = createLinkBridge(true)
    bridge.connect()
    const ws = MockWebSocket.instances[0]
    ws.open()
    expect(bridge.getState().connected).toBe(true)

    ws.triggerClose()
    expect(bridge.getState().connected).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(MockWebSocket.instances).toHaveLength(2) // retried
  })

  it('without autoRetry, does NOT reconnect after a drop', () => {
    const bridge = createLinkBridge(false)
    bridge.connect()
    MockWebSocket.instances[0].open()
    MockWebSocket.instances[0].triggerClose()
    vi.advanceTimersByTime(10000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('onerror advances to the next loopback address on retry', () => {
    const bridge = createLinkBridge(true)
    bridge.connect()
    const ws0 = MockWebSocket.instances[0]
    expect(ws0.url).toBe('ws://127.0.0.1:19876')
    ws0.triggerError() // advance idx + close
    ws0.triggerClose()
    vi.advanceTimersByTime(5000)
    expect(MockWebSocket.instances[1].url).toBe('ws://[::1]:19876')
  })

  it('disconnect() closes the socket, resets connected, and stops retrying', () => {
    const bridge = createLinkBridge(true)
    bridge.connect()
    const ws = MockWebSocket.instances[0]
    ws.open()
    bridge.disconnect()
    expect(ws.closed).toBe(true)
    expect(bridge.getState().connected).toBe(false)
    expect(bridge.getState().peers).toBe(0)

    vi.advanceTimersByTime(10000)
    expect(MockWebSocket.instances).toHaveLength(1) // no retry after disconnect
  })
})
