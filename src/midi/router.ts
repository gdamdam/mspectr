// MIDI input router for mspectr. Original work — AGPL-3.0-only.
//
// Adapted from mpumpit's MidiRouter (src/midi/router.ts): the access/enumerate/
// hot-plug lifecycle, the per-owner active-note ref-counting that prevents hung
// notes across duplicate Note Ons, device removal and reconfiguration, and the
// `onmidimessage`-opens-the-port detail. The mpumpit-specific channel→part
// routing and drum mapping are dropped (mspectr is a single instrument), and
// three things are added for this instrument:
//   - sustain pedal (CC 64): note-offs are held while the pedal is down and
//     flushed on release;
//   - pitch bend → signed semitones via a settable bend range;
//   - generic device-name change notification.
//
// Ownership model (single instrument, no channels in the voice key):
//   owners:    "<inputId>|<channel>|<incomingNote>" -> engineNote
//   noteRefs:  "<engineNote>" -> Set<ownerKey>
// Two inputs (or two channels) holding the same note SHARE one engine note; we
// ref-count holders and only emit onNoteOff when the LAST holder releases.
//
// No MIDIOutput is ever created → no possibility of a MIDI feedback loop.

import { clamp } from '../audio/contracts'
import { parseMidiMessage } from './parse'
import type {
  MidiAccessLike,
  MidiCapableNavigator,
  MidiRouterCallbacks,
} from './types'

/** Hard MIDI note range. */
const MIN_NOTE = 0
const MAX_NOTE = 127
const MIN_VELOCITY = 1
const MAX_VELOCITY = 127

/** Sustain pedal (CC 64) is "down" at value >= 64 (the spec midpoint). */
const CC_SUSTAIN = 64
const SUSTAIN_DOWN_THRESHOLD = 64

/** Default pitch-bend range in semitones (a whole tone up/down). */
const DEFAULT_BEND_RANGE = 2
/** Bend range is clamped to the contract's bendRange domain, 0..24. */
const MAX_BEND_RANGE = 24

export class MidiRouter {
  private readonly callbacks: MidiRouterCallbacks

  private access: MidiAccessLike | null = null
  private disposed = false

  /** Pitch-bend range in semitones; settable, default 2. */
  private bendRange = DEFAULT_BEND_RANGE

  /** Sustain pedal state. While down, note-offs are deferred. */
  private sustainDown = false

  // inputId -> the message handler currently attached to that input.
  private readonly handlers = new Map<string, (event: { data: Uint8Array | null }) => void>()

  // ownerKey -> engineNote it is holding.
  private readonly owners = new Map<string, number>()
  // engineNote -> set of ownerKeys holding it (ref count for shared notes).
  private readonly noteRefs = new Map<number, Set<string>>()
  // Notes whose release is deferred because the sustain pedal is down.
  // engineNote -> true. A note enters this set when its last owner releases
  // while the pedal is held; it is flushed (onNoteOff emitted) on pedal up.
  private readonly sustained = new Set<number>()

  constructor(callbacks: MidiRouterCallbacks = {}) {
    this.callbacks = callbacks
  }

  // ── Access / enumeration ──────────────────────────────────────────────────

  /** True when this environment exposes the Web MIDI API. */
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof (navigator as MidiCapableNavigator).requestMIDIAccess === 'function'
    )
  }

  /**
   * Request MIDI access and begin listening. Resolves `true` on success,
   * `false` if Web MIDI is unsupported or the user denied permission. Never
   * throws — an unsupported browser or a rejected prompt is a normal outcome.
   */
  async enable(): Promise<boolean> {
    if (!MidiRouter.isSupported()) return false
    let access: MidiAccessLike
    try {
      // sysex:false — we never need it, and it avoids an extra permission prompt.
      access = await (navigator as MidiCapableNavigator).requestMIDIAccess!({ sysex: false })
    } catch {
      return false
    }
    // Guard against a dispose() that landed while the request was pending (e.g.
    // React StrictMode mount→unmount→mount): don't attach a zombie listener set.
    if (this.disposed) return false
    this.access = access
    access.onstatechange = () => this.handleStateChange()
    this.attachListeners()
    this.emitDevicesChanged()
    return true
  }

  /** Display names of the currently connected inputs. */
  listInputs(): string[] {
    if (!this.access) return []
    const names: string[] = []
    this.access.inputs.forEach((input) => {
      if (input.state === undefined || input.state === 'connected') {
        names.push(input.name ?? 'Unknown')
      }
    })
    return names
  }

  /** Set the pitch-bend range in semitones (clamped to the contract domain). */
  setBendRange(semitones: number): void {
    this.bendRange = clamp(Number.isFinite(semitones) ? semitones : DEFAULT_BEND_RANGE, 0, MAX_BEND_RANGE)
  }

  // ── Listener management ─────────────────────────────────────────────────────

  private attachListeners(): void {
    if (!this.access) return
    const seen = new Set<string>()
    this.access.inputs.forEach((input) => {
      seen.add(input.id)
      if (input.state !== undefined && input.state !== 'connected') return
      if (this.handlers.has(input.id)) return // already listening
      const handler = (event: { data: Uint8Array | null }) =>
        this.handleMessage(input.id, event.data)
      // Set `onmidimessage` (the IDL attribute), NOT addEventListener: per the
      // Web MIDI spec this implicitly OPENS the input port, and browsers only
      // deliver messages from an open port. addEventListener alone leaves the
      // port closed, so virtual buses (macOS IAC, loopMIDI) stay silent.
      input.onmidimessage = handler
      this.handlers.set(input.id, handler)
      // Belt-and-suspenders: explicitly open if available. Swallow rejection so
      // it isn't unhandled.
      try {
        input.open?.()?.catch?.(() => {})
      } catch {
        /* sync throw — ignore */
      }
    })
    // Drop handlers for inputs that have disappeared entirely from the map.
    for (const id of [...this.handlers.keys()]) {
      if (!seen.has(id)) this.detachInput(id)
    }
  }

  private detachInput(inputId: string): void {
    if (this.access) {
      const input = this.access.inputs.get(inputId)
      if (input) {
        try {
          input.onmidimessage = null
        } catch {
          /* ignore */
        }
      }
    }
    this.handlers.delete(inputId)
  }

  private detachAll(): void {
    for (const id of [...this.handlers.keys()]) this.detachInput(id)
  }

  private handleStateChange(): void {
    if (!this.access) return
    // Release notes owned by any input that has gone away or disconnected, so a
    // device unplugged mid-note never leaves a hung voice.
    const present = new Set<string>()
    this.access.inputs.forEach((input) => {
      if (input.state === undefined || input.state === 'connected') present.add(input.id)
    })
    for (const id of [...this.handlers.keys()]) {
      if (!present.has(id)) this.releaseInput(id)
    }
    // Attach any newly connected inputs.
    this.attachListeners()
    this.emitDevicesChanged()
  }

  private emitDevicesChanged(): void {
    this.callbacks.onDevicesChanged?.(this.listInputs())
  }

  // ── Message handling ────────────────────────────────────────────────────────

  /** Public for tests; normally invoked from the onmidimessage listener. */
  handleMessage(inputId: string, data: Uint8Array | ReadonlyArray<number> | null | undefined): void {
    if (!data || data.length === 0) return
    const ev = parseMidiMessage(data)
    switch (ev.kind) {
      case 'noteOn':
        this.routeNoteOn(inputId, ev.channel, ev.note, ev.velocity)
        break
      case 'noteOff':
        this.routeNoteOff(inputId, ev.channel, ev.note)
        break
      case 'controlChange':
        if (ev.controller === CC_SUSTAIN) this.handleSustain(ev.value)
        break
      case 'pitchBend':
        this.handlePitchBend(ev.normalized)
        break
      case 'allNotesOff':
        // CC 120 / 123 — release everything (channel-mode panic).
        this.panic()
        this.callbacks.onPanic?.()
        break
      case 'clock':
      case 'start':
      case 'stop':
      case 'ignored':
        break
    }
  }

  private routeNoteOn(inputId: string, channel: number, note: number, velocity: number): void {
    // A misbehaving device must never produce an out-of-range or NaN note.
    if (!Number.isFinite(note) || !Number.isFinite(velocity)) return
    const engineNote = clamp(Math.round(note), MIN_NOTE, MAX_NOTE)
    const vel = clamp(Math.round(velocity), MIN_VELOCITY, MAX_VELOCITY)

    const ownerKey = `${inputId}|${channel}|${engineNote}`
    // A repeat Note On from the same holder is a retrigger, not a second ref:
    // drop the stale ref before re-adding so the count stays correct.
    if (this.owners.has(ownerKey)) this.removeRef(this.owners.get(ownerKey)!, ownerKey)

    this.owners.set(ownerKey, engineNote)
    this.addRef(engineNote, ownerKey)
    // A retriggered note that was pending sustain release is sounding again.
    this.sustained.delete(engineNote)
    this.callbacks.onNoteOn?.(engineNote, vel)
  }

  private routeNoteOff(inputId: string, channel: number, note: number): void {
    if (!Number.isFinite(note)) return
    const engineNote = clamp(Math.round(note), MIN_NOTE, MAX_NOTE)
    const ownerKey = `${inputId}|${channel}|${engineNote}`
    if (!this.owners.has(ownerKey)) return // late / unmatched Note Off — ignore
    this.owners.delete(ownerKey)
    this.releaseRef(engineNote, ownerKey)
  }

  private handleSustain(value: number): void {
    const down = value >= SUSTAIN_DOWN_THRESHOLD
    if (down === this.sustainDown) return
    this.sustainDown = down
    this.callbacks.onSustain?.(down)
    if (!down) {
      // Pedal up: flush every note whose physical key was already released.
      for (const note of [...this.sustained]) {
        this.sustained.delete(note)
        // Only actually silence it if no live owner has re-grabbed it.
        if (!this.noteRefs.has(note)) this.callbacks.onNoteOff?.(note)
      }
    }
  }

  private handlePitchBend(normalized: number): void {
    if (!Number.isFinite(normalized)) return
    const n = clamp(normalized, -1, 1)
    this.callbacks.onPitchBend?.(n * this.bendRange)
  }

  /** Release every note owned by an input (call on disconnect). */
  releaseInput(inputId: string): void {
    const prefix = `${inputId}|`
    for (const key of [...this.owners.keys()]) {
      if (key.startsWith(prefix)) {
        const note = this.owners.get(key)!
        this.owners.delete(key)
        this.releaseRef(note, key, /*force*/ true)
      }
    }
    // Flush any sustain-pedal-held notes: their physical keys were already
    // released (only the sounding was deferred), so they cannot belong to any
    // still-held owner. Leaving them parked after a disconnect would hang a
    // note that nothing can ever release. Force past sustain.
    for (const note of [...this.sustained]) {
      this.sustained.delete(note)
      if (!this.noteRefs.has(note)) this.callbacks.onNoteOff?.(note)
    }
    // Pitch bend and sustain are global at the engine boundary. A disconnected
    // controller cannot send the matching centre/pedal-up messages, so reset.
    this.sustainDown = false
    this.callbacks.onSustain?.(false)
    this.callbacks.onPitchBend?.(0)
    this.detachInput(inputId)
  }

  /** Hard panic: force-release router state. Notification is owned by callers. */
  panic(): void {
    const notes = new Set([...this.noteRefs.keys(), ...this.sustained])
    this.owners.clear()
    this.noteRefs.clear()
    this.sustained.clear()
    this.sustainDown = false
    for (const note of notes) this.callbacks.onNoteOff?.(note)
    this.callbacks.onSustain?.(false)
    this.callbacks.onPitchBend?.(0)
  }

  /** Number of currently sounding (or sustain-held) engine notes. */
  get activeNoteCount(): number {
    return this.noteRefs.size + this.sustained.size
  }

  dispose(): void {
    this.disposed = true
    this.detachAll()
    if (this.access) this.access.onstatechange = null
    this.owners.clear()
    this.noteRefs.clear()
    this.sustained.clear()
    this.access = null
  }

  // ── Ref counting ────────────────────────────────────────────────────────────

  private addRef(note: number, ownerKey: string): void {
    let set = this.noteRefs.get(note)
    if (!set) {
      set = new Set()
      this.noteRefs.set(note, set)
    }
    set.add(ownerKey)
  }

  private removeRef(note: number, ownerKey: string): void {
    const set = this.noteRefs.get(note)
    if (!set) return
    set.delete(ownerKey)
    if (set.size === 0) this.noteRefs.delete(note)
  }

  /**
   * Drop one holder of `note` and, when it was the last holder, release the
   * note. With the sustain pedal down a normal release is deferred (the note is
   * parked in `sustained` and flushed on pedal-up); `force` (device removal /
   * panic path) bypasses sustain so an unplugged device never leaves a hung
   * note even with the pedal held.
   */
  private releaseRef(note: number, ownerKey: string, force = false): void {
    const set = this.noteRefs.get(note)
    if (!set) return
    set.delete(ownerKey)
    if (set.size > 0) return // other holders remain
    this.noteRefs.delete(note)
    if (this.sustainDown && !force) {
      this.sustained.add(note)
      return
    }
    this.sustained.delete(note)
    this.callbacks.onNoteOff?.(note)
  }
}
