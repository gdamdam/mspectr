// Live MIDI message decoding for mspectr. Original work — AGPL-3.0-only.
//
// Derived from mpumpit's live decoder (src/midi/parse.ts). Byte conventions:
//   status & 0xf0 = message type, status & 0x0f = channel (0–15).
//   A Note On with velocity 0 is treated as a Note Off.
// Live Web MIDI delivers a complete message with its own status byte, so the
// running status used in offline .mid files does not occur. Defensive guards
// below reject any buffer that begins with a data byte (a sliced payload or a
// non-compliant driver emitting running status), classifying it as `ignored`
// rather than mis-decoding it — a hostile or buggy device must never produce a
// note event.
//
// mspectr-specific additions over the mpumpit source: pitch bend is decoded to
// a 14-bit value + normalized position (mpumpit ignored it), generic CC is
// surfaced as `controlChange` (mpumpit only cared about all-notes-off), and
// transport start/stop are split out from clock.

import type { MidiEvent } from './types'

// MIDI status nibbles (channel-voice messages).
const NOTE_OFF = 0x80
const NOTE_ON = 0x90
const CONTROL_CHANGE = 0xb0
const PITCH_BEND = 0xe0

// System real-time status bytes.
const SYS_START = 0xfa
const SYS_STOP = 0xfc
const SYS_CLOCK = 0xf8

// Channel-mode controllers that mean "release everything".
const CC_ALL_SOUND_OFF = 120
const CC_ALL_NOTES_OFF = 123

// Pitch-bend centre (no bend) for a 14-bit value, range 0..16383.
const PITCH_BEND_CENTER = 0x2000 // 8192

/** 7-bit data-byte mask; every MIDI data byte is in 0..127. */
const DATA_MASK = 0x7f

/**
 * Decode one raw MIDI message into a structured {@link MidiEvent}.
 *
 * Accepts the live `Uint8Array` payload (or any indexable number sequence). All
 * data bytes are masked with 0x7f so a stray high bit can never push a note or
 * controller out of 0..127. Unknown / unsupported messages decode to `ignored`.
 */
export function parseMidiMessage(data: Uint8Array | ReadonlyArray<number> | null | undefined): MidiEvent {
  if (!data || data.length === 0) return { kind: 'ignored' }

  const status = data[0] ?? 0

  // A status byte always has its high bit set. A buffer that begins with a data
  // byte is a running-status fragment or a malformed payload — not decodable on
  // its own, so ignore it defensively rather than guessing a status.
  if ((status & 0x80) === 0) return { kind: 'ignored' }

  // System real-time (single status byte, no payload).
  if (status >= 0xf8) {
    if (status === SYS_START) return { kind: 'start' }
    if (status === SYS_STOP) return { kind: 'stop' }
    // 0xF8 clock, 0xFB continue, 0xFE active sensing, 0xFF reset, … — bucket as
    // clock so the consumer can throttle/ignore transport without erroring.
    if (status === SYS_CLOCK) return { kind: 'clock' }
    return { kind: 'clock' }
  }
  // System common (0xF0–0xF7: SysEx, MTC quarter-frame, song position/select,
  // tune request). None are used by mspectr.
  if (status >= 0xf0) return { kind: 'ignored' }

  const type = status & 0xf0
  const channel = (status & 0x0f) + 1 // 1–16, human-facing

  switch (type) {
    case NOTE_ON: {
      const note = (data[1] ?? 0) & DATA_MASK
      const velocity = (data[2] ?? 0) & DATA_MASK
      // Note On with velocity 0 is a Note Off (running-status convention).
      if (velocity === 0) return { kind: 'noteOff', channel, note }
      return { kind: 'noteOn', channel, note, velocity }
    }
    case NOTE_OFF: {
      const note = (data[1] ?? 0) & DATA_MASK
      return { kind: 'noteOff', channel, note }
    }
    case CONTROL_CHANGE: {
      const controller = (data[1] ?? 0) & DATA_MASK
      const value = (data[2] ?? 0) & DATA_MASK
      // CC 120 (All Sound Off) / 123 (All Notes Off) → panic-style release.
      if (controller === CC_ALL_SOUND_OFF || controller === CC_ALL_NOTES_OFF) {
        return { kind: 'allNotesOff', channel, controller }
      }
      return { kind: 'controlChange', channel, controller, value }
    }
    case PITCH_BEND: {
      // 14-bit value: LSB in data[1], MSB in data[2], each 7 bits.
      const lsb = (data[1] ?? 0) & DATA_MASK
      const msb = (data[2] ?? 0) & DATA_MASK
      const value14 = (msb << 7) | lsb // 0..16383
      // Normalize to [-1, 1] around centre. Below centre uses the 8192-wide
      // lower half; above centre uses the 8191-wide upper half, so full-down
      // maps to exactly -1 and full-up to exactly +1.
      const offset = value14 - PITCH_BEND_CENTER
      const normalized = offset < 0 ? offset / PITCH_BEND_CENTER : offset / (PITCH_BEND_CENTER - 1)
      return { kind: 'pitchBend', channel, value14, normalized }
    }
    default:
      // Polyphonic/channel aftertouch, program change, etc.
      return { kind: 'ignored' }
  }
}
