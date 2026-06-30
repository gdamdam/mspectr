// Pure voice bookkeeping for the playable instrument.
//
// The AudioWorklet owns the actual sounding voices; this class only decides
// which integer `voiceIndex` (0..maxVoices-1) a note should map to, when a voice
// must be stolen, and which voices to force-release on sustain/panic/shrink. It
// holds no audio state and no wall-clock — ageing is a monotonically increasing
// counter so allocation is fully deterministic.

import { MIN_POLYPHONY, MAX_POLYPHONY, clamp } from '../audio/contracts'

export interface VoiceAllocation {
  /** The slot (0..maxVoices-1) the note was assigned to. */
  voiceIndex: number
  /** True when an already-sounding voice had to be reused for this note. */
  stolen: boolean
  /** The note that was evicted by stealing, or null if a free slot was used. */
  stolenNote: number | null
}

interface Slot {
  /** MIDI note currently held in this slot, or null when free. */
  note: number | null
  velocity: number
  /** Monotonic stamp; higher = newer. Used to pick the oldest voice to steal. */
  ageCounter: number
  /** True when the note was released but is held alive by the sustain pedal. */
  sustained: boolean
}

export class VoiceAllocator {
  private slots: Slot[] = []
  private maxVoices: number
  /** Ever-increasing stamp so "oldest sounding" is unambiguous. */
  private age = 0
  private sustainOn = false

  constructor(maxVoices: number) {
    this.maxVoices = clamp(Math.round(maxVoices), MIN_POLYPHONY, MAX_POLYPHONY)
    this.allocateSlots()
  }

  private allocateSlots(): void {
    this.slots = []
    for (let i = 0; i < this.maxVoices; i++) {
      this.slots.push({ note: null, velocity: 0, ageCounter: 0, sustained: false })
    }
  }

  /**
   * Resize the voice pool. Growing adds free slots; shrinking drops the
   * highest-index slots and returns the voiceIndices that must be force-released
   * so the worklet never leaves a dropped voice hung.
   */
  setMaxVoices(n: number): number[] {
    const next = clamp(Math.round(n), MIN_POLYPHONY, MAX_POLYPHONY)
    if (next === this.maxVoices) return []
    const released: number[] = []
    if (next < this.maxVoices) {
      // Any active slot at or above the new ceiling is gone.
      for (let i = next; i < this.maxVoices; i++) {
        if (this.slots[i].note !== null) released.push(i)
      }
      this.slots.length = next
    } else {
      for (let i = this.maxVoices; i < next; i++) {
        this.slots.push({ note: null, velocity: 0, ageCounter: 0, sustained: false })
      }
    }
    this.maxVoices = next
    return released
  }

  /**
   * Assign a slot for `note`. Retriggering a sounding (or sustained) note reuses
   * its slot; otherwise the first free slot is used; otherwise the OLDEST
   * sounding voice is stolen.
   */
  noteOn(note: number, velocity: number): VoiceAllocation {
    const stamp = ++this.age

    // Retrigger: reuse the slot already holding this note.
    const existing = this.findSlot(note)
    if (existing !== -1) {
      const slot = this.slots[existing]
      slot.velocity = velocity
      slot.ageCounter = stamp
      slot.sustained = false
      return { voiceIndex: existing, stolen: false, stolenNote: null }
    }

    // Free slot.
    const free = this.slots.findIndex((s) => s.note === null)
    if (free !== -1) {
      this.slots[free] = { note, velocity, ageCounter: stamp, sustained: false }
      return { voiceIndex: free, stolen: false, stolenNote: null }
    }

    // Steal the oldest (lowest ageCounter) voice. Sustained voices are still
    // candidates — when full, even held-by-pedal notes can be stolen.
    let victim = 0
    let oldest = Infinity
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].ageCounter < oldest) {
        oldest = this.slots[i].ageCounter
        victim = i
      }
    }
    const stolenNote = this.slots[victim].note
    this.slots[victim] = { note, velocity, ageCounter: stamp, sustained: false }
    return { voiceIndex: victim, stolen: true, stolenNote }
  }

  /**
   * Release `note`. Returns the voiceIndices to release immediately, or `[]` if
   * the note is latched by the sustain pedal (it is marked sustained and kept
   * alive until the pedal lifts).
   */
  noteOff(note: number): number[] {
    const index = this.findSlot(note)
    if (index === -1) return []
    if (this.sustainOn) {
      this.slots[index].sustained = true
      return []
    }
    this.freeSlot(index)
    return [index]
  }

  /**
   * Toggle the sustain pedal. Pressing latches (notes released while held stay
   * alive). Lifting releases every note that was released during the hold and
   * returns their voiceIndices.
   */
  setSustain(on: boolean): number[] {
    if (on === this.sustainOn) return []
    this.sustainOn = on
    if (on) return []
    const released: number[] = []
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].sustained) {
        released.push(i)
        this.freeSlot(i)
      }
    }
    return released
  }

  /** Force-release everything and clear all state. Returns active voiceIndices. */
  panic(): number[] {
    const active: number[] = []
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].note !== null) active.push(i)
      this.slots[i] = { note: null, velocity: 0, ageCounter: 0, sustained: false }
    }
    this.age = 0
    this.sustainOn = false
    return active
  }

  /** Count of slots currently holding a note (including sustained). */
  activeCount(): number {
    let count = 0
    for (const slot of this.slots) if (slot.note !== null) count++
    return count
  }

  /** Velocity of a sounding note, or undefined if it is not held. */
  velocityOf(note: number): number | undefined {
    const index = this.findSlot(note)
    return index === -1 ? undefined : this.slots[index].velocity
  }

  private findSlot(note: number): number {
    return this.slots.findIndex((s) => s.note === note)
  }

  private freeSlot(index: number): void {
    this.slots[index] = { note: null, velocity: 0, ageCounter: 0, sustained: false }
  }
}
