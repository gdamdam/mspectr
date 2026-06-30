// MIDI domain types for mspectr. Original work — AGPL-3.0-only.
//
// Derived from the proven model in mpumpit (src/midi/types.ts): a discriminated
// MidiEvent union decoded from raw bytes plus listener/callback interfaces. The
// event union is reshaped for mspectr's single-instrument model — there are no
// per-part channels here, and pitch bend is a first-class event (mspectr maps it
// to semitones), where mpumpit treated it as `ignored`.
//
// WebMIDI ambient types (@types/webmidi) are NOT a dependency of this project,
// so the minimal slice of the Web MIDI API surface this workstream touches is
// declared structurally below. Only the members actually used are modelled, so
// a real `MIDIAccess` / `MIDIInput` from the browser satisfies these shapes.

// ---------------------------------------------------------------------------
// Parsed MIDI events (discriminated union)
// ---------------------------------------------------------------------------

/**
 * A single decoded inbound MIDI message.
 *
 * `pitchBend` carries both the raw 14-bit value (`value14`, 0..16383, centre
 * 8192) and a `normalized` position in [-1, 1]; the router scales `normalized`
 * by the bend range to produce semitones. `allNotesOff` covers CC 120 (All
 * Sound Off) and CC 123 (All Notes Off). System real-time messages decode to
 * `clock` / `start` / `stop` so callers can ignore transport without erroring.
 * Everything else (aftertouch, program change, system common, SysEx, malformed
 * running-status fragments) → `ignored`.
 */
export type MidiEvent =
  | { kind: 'noteOn'; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; channel: number; note: number }
  | { kind: 'controlChange'; channel: number; controller: number; value: number }
  | { kind: 'pitchBend'; channel: number; value14: number; normalized: number }
  | { kind: 'allNotesOff'; channel: number; controller: number } // CC 120 / 123
  | { kind: 'clock' } // 0xF8 timing clock & other high-rate system real-time
  | { kind: 'start' } // 0xFA
  | { kind: 'stop' } // 0xFC
  | { kind: 'ignored' }

export type MidiEventKind = MidiEvent['kind']

// ---------------------------------------------------------------------------
// Router callbacks (the consumer-facing sink)
// ---------------------------------------------------------------------------

/**
 * Sink the {@link MidiRouter} drives. Every callback is optional so a consumer
 * can subscribe to only what it needs. The router guarantees:
 *  - `onNoteOff(note)` fires for every note that `onNoteOn` started, exactly
 *    once, when the last owner releases it (no hung notes).
 *  - `onPitchBend` reports a signed semitone offset already scaled by the
 *    settable bend range.
 *  - all numbers handed to callbacks are finite and in range.
 */
export interface MidiRouterCallbacks {
  onNoteOn?: (note: number, velocity: number) => void
  onNoteOff?: (note: number) => void
  /** Signed semitone offset, already scaled by the current bend range. */
  onPitchBend?: (semitones: number) => void
  /** Sustain pedal (CC 64) crossed the halfway threshold. */
  onSustain?: (on: boolean) => void
  /** Hard reset — every note has been force-released. */
  onPanic?: () => void
  /** Connected input display names changed (hot-plug / enable). */
  onDevicesChanged?: (names: string[]) => void
}

// ---------------------------------------------------------------------------
// Minimal structural slice of the Web MIDI API
// ---------------------------------------------------------------------------
//
// These mirror the members of the real DOM interfaces this workstream uses.
// Declared locally because @types/webmidi is not installed and configs are
// out of scope for this workstream. A genuine browser MIDIAccess/MIDIInput is
// structurally assignable to these.

/** A raw inbound message event — only the `data` payload is consumed. */
export interface MidiMessageEventLike {
  readonly data: Uint8Array | null
}

/** Connection-state event delivered to `MIDIAccess.onstatechange`. */
export interface MidiConnectionEventLike {
  readonly port?: { readonly id: string; readonly state?: string } | null
}

/** A single MIDI input port. */
export interface MidiInputLike {
  readonly id: string
  readonly name?: string | null
  readonly manufacturer?: string | null
  /** "connected" | "disconnected". */
  readonly state?: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
  /** Opening a port is best-effort; not all environments expose it. */
  open?: () => Promise<unknown>
}

/** The access object returned by `navigator.requestMIDIAccess`. */
export interface MidiAccessLike {
  readonly inputs: ReadonlyMap<string, MidiInputLike>
  onstatechange: ((event: MidiConnectionEventLike) => void) | null
}

/** Options bag for `requestMIDIAccess`. */
export interface MidiAccessOptions {
  sysex?: boolean
  software?: boolean
}

/** A navigator that may expose Web MIDI. */
export interface MidiCapableNavigator {
  requestMIDIAccess?: (options?: MidiAccessOptions) => Promise<MidiAccessLike>
}
