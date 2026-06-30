import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MidiRouter } from './router'
import type { MidiAccessLike, MidiConnectionEventLike, MidiInputLike } from './types'

// ── Mock Web MIDI harness ────────────────────────────────────────────────────

class MockInput implements MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null
  state = 'connected'
  open = vi.fn(() => Promise.resolve())
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly manufacturer = 'Acme',
  ) {}

  /** Simulate the device delivering a raw message to the open port. */
  send(...bytes: number[]): void {
    this.onmidimessage?.({ data: Uint8Array.from(bytes) })
  }
}

class MockAccess implements MidiAccessLike {
  inputs = new Map<string, MockInput>()
  onstatechange: ((event: MidiConnectionEventLike) => void) | null = null

  add(input: MockInput): void {
    this.inputs.set(input.id, input)
    this.onstatechange?.({ port: { id: input.id, state: input.state } })
  }

  /** Mark an input disconnected and fire the state-change event. */
  disconnect(id: string): void {
    const input = this.inputs.get(id)
    if (!input) return
    input.state = 'disconnected'
    this.onstatechange?.({ port: { id, state: 'disconnected' } })
  }

  /** Remove an input entirely (unplugged) and fire the state-change event. */
  remove(id: string): void {
    this.inputs.delete(id)
    this.onstatechange?.({ port: { id, state: 'disconnected' } })
  }
}

let access: MockAccess
let requestMIDIAccess: ReturnType<typeof vi.fn>

function installNavigator(impl?: () => Promise<MidiAccessLike>): void {
  requestMIDIAccess = vi.fn(impl ?? (() => Promise.resolve(access)))
  vi.stubGlobal('navigator', { requestMIDIAccess })
}

beforeEach(() => {
  access = new MockAccess()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeCallbacks() {
  return {
    onNoteOn: vi.fn(),
    onNoteOff: vi.fn(),
    onPitchBend: vi.fn(),
    onSustain: vi.fn(),
    onPanic: vi.fn(),
    onDevicesChanged: vi.fn(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MidiRouter.enable', () => {
  it('returns true and requests sysex:false access', async () => {
    installNavigator()
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await expect(router.enable()).resolves.toBe(true)
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false })
    router.dispose()
  })

  it('returns false when Web MIDI is unsupported', async () => {
    vi.stubGlobal('navigator', {}) // no requestMIDIAccess
    const router = new MidiRouter()
    await expect(router.enable()).resolves.toBe(false)
  })

  it('returns false when the user denies the permission prompt', async () => {
    installNavigator(() => Promise.reject(new Error('SecurityError')))
    const router = new MidiRouter()
    await expect(router.enable()).resolves.toBe(false)
  })

  it('enumerates connected inputs and notifies onDevicesChanged', async () => {
    installNavigator()
    access.inputs.set('a', new MockInput('a', 'Keystation'))
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()
    expect(router.listInputs()).toEqual(['Keystation'])
    expect(cb.onDevicesChanged).toHaveBeenCalledWith(['Keystation'])
    router.dispose()
  })
})

describe('note routing', () => {
  let router: MidiRouter
  let cb: ReturnType<typeof makeCallbacks>
  let input: MockInput

  beforeEach(async () => {
    installNavigator()
    input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    cb = makeCallbacks()
    router = new MidiRouter(cb)
    await router.enable()
  })

  afterEach(() => router.dispose())

  it('emits onNoteOn / onNoteOff', () => {
    input.send(0x90, 60, 100)
    expect(cb.onNoteOn).toHaveBeenCalledWith(60, 100)
    input.send(0x80, 60, 0)
    expect(cb.onNoteOff).toHaveBeenCalledWith(60)
  })

  it('treats Note On velocity 0 as a Note Off', () => {
    input.send(0x90, 62, 90)
    input.send(0x90, 62, 0)
    expect(cb.onNoteOff).toHaveBeenCalledWith(62)
  })

  it('ignores a late / unmatched Note Off (no hung note)', () => {
    input.send(0x80, 70, 0)
    expect(cb.onNoteOff).not.toHaveBeenCalled()
    expect(router.activeNoteCount).toBe(0)
  })

  it('ref-counts a shared note across two inputs: off only on last release', async () => {
    const input2 = new MockInput('b', 'Pads')
    access.add(input2) // hot-plug
    input.send(0x90, 64, 100)
    input2.send(0x90, 64, 100)
    expect(cb.onNoteOn).toHaveBeenCalledTimes(2)
    // First holder releases — note must keep sounding.
    input.send(0x80, 64, 0)
    expect(cb.onNoteOff).not.toHaveBeenCalled()
    // Last holder releases — now it goes off exactly once.
    input2.send(0x80, 64, 0)
    expect(cb.onNoteOff).toHaveBeenCalledTimes(1)
    expect(cb.onNoteOff).toHaveBeenCalledWith(64)
  })
})

describe('sustain pedal (CC 64)', () => {
  let router: MidiRouter
  let cb: ReturnType<typeof makeCallbacks>
  let input: MockInput

  beforeEach(async () => {
    installNavigator()
    input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    cb = makeCallbacks()
    router = new MidiRouter(cb)
    await router.enable()
  })

  afterEach(() => router.dispose())

  it('holds note-offs while down and flushes them on release', () => {
    input.send(0xb0, 64, 127) // pedal down
    expect(cb.onSustain).toHaveBeenCalledWith(true)

    input.send(0x90, 60, 100)
    input.send(0x80, 60, 0) // key released, but pedal holds it
    expect(cb.onNoteOff).not.toHaveBeenCalled()

    input.send(0xb0, 64, 0) // pedal up -> flush
    expect(cb.onSustain).toHaveBeenLastCalledWith(false)
    expect(cb.onNoteOff).toHaveBeenCalledWith(60)
  })

  it('keeps a re-pressed note sounding through the pedal flush', () => {
    input.send(0xb0, 64, 127) // down
    input.send(0x90, 67, 100)
    input.send(0x80, 67, 0) // released into the pedal
    input.send(0x90, 67, 110) // re-pressed before pedal up
    input.send(0xb0, 64, 0) // pedal up
    // The re-pressed note is still held, so it must NOT be silenced.
    expect(cb.onNoteOff).not.toHaveBeenCalled()
  })

  it('does not re-fire onSustain for a repeated down value', () => {
    input.send(0xb0, 64, 127)
    input.send(0xb0, 64, 100) // still >= 64, no edge
    expect(cb.onSustain).toHaveBeenCalledTimes(1)
  })
})

describe('panic via CC 123', () => {
  it('releases all notes and fires onPanic', async () => {
    installNavigator()
    const input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()

    input.send(0x90, 60, 100)
    input.send(0x90, 64, 100)
    input.send(0xb0, 123, 0) // All Notes Off

    expect(cb.onNoteOff).toHaveBeenCalledWith(60)
    expect(cb.onNoteOff).toHaveBeenCalledWith(64)
    expect(cb.onPanic).toHaveBeenCalledTimes(1)
    expect(router.activeNoteCount).toBe(0)
    router.dispose()
  })

  it('panic() ignores the sustain pedal (force release)', async () => {
    installNavigator()
    const input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()

    input.send(0xb0, 64, 127) // pedal down
    input.send(0x90, 60, 100)
    router.panic()
    expect(cb.onNoteOff).toHaveBeenCalledWith(60)
    expect(router.activeNoteCount).toBe(0)
    router.dispose()
  })
})

describe('pitch bend', () => {
  let router: MidiRouter
  let cb: ReturnType<typeof makeCallbacks>
  let input: MockInput

  beforeEach(async () => {
    installNavigator()
    input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    cb = makeCallbacks()
    router = new MidiRouter(cb)
    await router.enable()
  })

  afterEach(() => router.dispose())

  it('scales full-up bend to +bendRange semitones (default 2)', () => {
    input.send(0xe0, 0x7f, 0x7f) // full up -> normalized +1
    expect(cb.onPitchBend).toHaveBeenLastCalledWith(2)
  })

  it('scales full-down bend to -bendRange semitones', () => {
    input.send(0xe0, 0x00, 0x00) // full down -> normalized -1
    expect(cb.onPitchBend).toHaveBeenLastCalledWith(-2)
  })

  it('centre bend is 0 semitones', () => {
    input.send(0xe0, 0x00, 0x40) // centre
    expect(cb.onPitchBend).toHaveBeenLastCalledWith(0)
  })

  it('respects a settable bend range', () => {
    router.setBendRange(12)
    input.send(0xe0, 0x7f, 0x7f)
    expect(cb.onPitchBend).toHaveBeenLastCalledWith(12)
  })

  it('clamps a hostile bend range to the contract domain (0..24)', () => {
    router.setBendRange(999)
    input.send(0xe0, 0x7f, 0x7f)
    expect(cb.onPitchBend).toHaveBeenLastCalledWith(24)
  })
})

describe('hot-plug device removal', () => {
  it('releases notes owned by a removed device (no hung notes)', async () => {
    installNavigator()
    const input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()

    input.send(0x90, 60, 100)
    expect(router.activeNoteCount).toBe(1)

    access.remove('a') // unplugged mid-note
    expect(cb.onNoteOff).toHaveBeenCalledWith(60)
    expect(router.activeNoteCount).toBe(0)
    expect(cb.onDevicesChanged).toHaveBeenLastCalledWith([])
    router.dispose()
  })

  it('releases held-by-pedal notes when the owning device is removed', async () => {
    installNavigator()
    const input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()

    input.send(0xb0, 64, 127) // pedal down on this device
    input.send(0x90, 62, 100)
    input.send(0x80, 62, 0) // released into the pedal (deferred)
    expect(cb.onNoteOff).not.toHaveBeenCalled()

    access.remove('a') // device pulled — must not leave a hung sustained note
    expect(cb.onNoteOff).toHaveBeenCalledWith(62)
    expect(router.activeNoteCount).toBe(0)
    router.dispose()
  })

  it('attaches and hears a hot-plugged device', async () => {
    installNavigator()
    const cb = makeCallbacks()
    const router = new MidiRouter(cb)
    await router.enable()
    expect(router.listInputs()).toEqual([])

    const input = new MockInput('b', 'Late Arrival')
    access.add(input) // plugged in after enable
    expect(cb.onDevicesChanged).toHaveBeenLastCalledWith(['Late Arrival'])

    input.send(0x90, 72, 100)
    expect(cb.onNoteOn).toHaveBeenCalledWith(72, 100)
    router.dispose()
  })
})

describe('hostile / malformed input', () => {
  let router: MidiRouter
  let cb: ReturnType<typeof makeCallbacks>
  let input: MockInput

  beforeEach(async () => {
    installNavigator()
    input = new MockInput('a', 'Evil')
    access.inputs.set('a', input)
    cb = makeCallbacks()
    router = new MidiRouter(cb)
    await router.enable()
  })

  afterEach(() => router.dispose())

  it('never emits an out-of-range note from masked bytes', () => {
    input.send(0x90, 0xff, 0xff) // masks to note 127, velocity 127
    expect(cb.onNoteOn).toHaveBeenCalledWith(127, 127)
    const [note] = cb.onNoteOn.mock.calls[0]
    expect(Number.isFinite(note)).toBe(true)
    expect(note).toBeLessThanOrEqual(127)
    expect(note).toBeGreaterThanOrEqual(0)
  })

  it('ignores empty data', () => {
    input.onmidimessage?.({ data: Uint8Array.from([]) })
    input.onmidimessage?.({ data: null })
    expect(cb.onNoteOn).not.toHaveBeenCalled()
  })
})

describe('dispose', () => {
  it('detaches listeners and clears the access onstatechange', async () => {
    installNavigator()
    const input = new MockInput('a', 'Keys')
    access.inputs.set('a', input)
    const router = new MidiRouter(makeCallbacks())
    await router.enable()
    expect(input.onmidimessage).not.toBeNull()
    router.dispose()
    expect(input.onmidimessage).toBeNull()
    expect(access.onstatechange).toBeNull()
  })
})
