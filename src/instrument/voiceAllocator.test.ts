import { describe, it, expect } from 'vitest'
import { VoiceAllocator } from './voiceAllocator'
import { MIN_POLYPHONY, MAX_POLYPHONY } from '../audio/contracts'

describe('VoiceAllocator construction', () => {
  it('clamps maxVoices into [MIN_POLYPHONY, MAX_POLYPHONY]', () => {
    const lo = new VoiceAllocator(0)
    // Fill it: should accept exactly MIN_POLYPHONY before stealing.
    for (let i = 0; i < MIN_POLYPHONY; i++) lo.noteOn(60 + i, 100)
    expect(lo.activeCount()).toBe(MIN_POLYPHONY)
    expect(lo.noteOn(80, 100).stolen).toBe(true)

    const hi = new VoiceAllocator(999)
    for (let i = 0; i < MAX_POLYPHONY; i++) hi.noteOn(40 + i, 100)
    expect(hi.activeCount()).toBe(MAX_POLYPHONY)
    expect(hi.noteOn(90, 100).stolen).toBe(true)
  })
})

describe('allocation and reuse', () => {
  it('uses distinct free slots for distinct notes', () => {
    const va = new VoiceAllocator(4)
    const a = va.noteOn(60, 100)
    const b = va.noteOn(62, 100)
    expect(a.stolen).toBe(false)
    expect(b.stolen).toBe(false)
    expect(a.voiceIndex).not.toBe(b.voiceIndex)
    expect(va.activeCount()).toBe(2)
  })

  it('reuses the same slot when retriggering a held note', () => {
    const va = new VoiceAllocator(4)
    const first = va.noteOn(60, 100)
    const retrigger = va.noteOn(60, 120)
    expect(retrigger.voiceIndex).toBe(first.voiceIndex)
    expect(retrigger.stolen).toBe(false)
    expect(va.activeCount()).toBe(1)
    expect(va.velocityOf(60)).toBe(120)
  })

  it('tracks velocity per note', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 77)
    va.noteOn(64, 99)
    expect(va.velocityOf(60)).toBe(77)
    expect(va.velocityOf(64)).toBe(99)
    expect(va.velocityOf(70)).toBeUndefined()
  })
})

describe('voice stealing', () => {
  it('steals the OLDEST sounding note when full', () => {
    const va = new VoiceAllocator(2)
    va.noteOn(60, 100) // oldest
    va.noteOn(62, 100)
    const steal = va.noteOn(64, 100)
    expect(steal.stolen).toBe(true)
    expect(steal.stolenNote).toBe(60)
    // 60 is gone, 62 and 64 remain.
    expect(va.velocityOf(60)).toBeUndefined()
    expect(va.velocityOf(62)).toBe(100)
    expect(va.velocityOf(64)).toBe(100)
    expect(va.activeCount()).toBe(2)
  })

  it('retrigger refreshes age so it is not the next steal victim', () => {
    const va = new VoiceAllocator(2)
    va.noteOn(60, 100) // initially oldest
    va.noteOn(62, 100)
    va.noteOn(60, 110) // retrigger -> now newest
    const steal = va.noteOn(64, 100)
    // 62 is now the oldest sounding note.
    expect(steal.stolenNote).toBe(62)
  })
})

describe('setMaxVoices shrink/grow', () => {
  it('returns voiceIndices to force-release when shrinking', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100) // slot 0
    va.noteOn(62, 100) // slot 1
    va.noteOn(64, 100) // slot 2
    va.noteOn(65, 100) // slot 3
    const released = va.setMaxVoices(2)
    // Slots 2 and 3 are dropped and must be released.
    expect(released.sort()).toEqual([2, 3])
    expect(va.activeCount()).toBe(2)
  })

  it('shrinking only releases active dropped slots', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100) // slot 0
    va.noteOn(62, 100) // slot 1
    // slots 2,3 free
    const released = va.setMaxVoices(2)
    expect(released).toEqual([])
    expect(va.activeCount()).toBe(2)
  })

  it('growing adds slots and returns nothing', () => {
    const va = new VoiceAllocator(2)
    va.noteOn(60, 100)
    va.noteOn(62, 100)
    expect(va.setMaxVoices(4)).toEqual([])
    // Now there is room for more without stealing.
    expect(va.noteOn(64, 100).stolen).toBe(false)
    expect(va.activeCount()).toBe(3)
  })

  it('no-op when target equals current', () => {
    const va = new VoiceAllocator(4)
    expect(va.setMaxVoices(4)).toEqual([])
  })
})

describe('sustain pedal', () => {
  it('latches released notes while held, then releases on lift', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100)
    va.noteOn(62, 100)
    va.setSustain(true)
    // noteOff while sustaining keeps the voice alive.
    expect(va.noteOff(60)).toEqual([])
    expect(va.activeCount()).toBe(2)
    expect(va.velocityOf(60)).toBe(100)
    // Lifting the pedal releases the sustained note.
    const released = va.setSustain(false)
    expect(released.length).toBe(1)
    expect(va.activeCount()).toBe(1)
    expect(va.velocityOf(60)).toBeUndefined()
    expect(va.velocityOf(62)).toBe(100)
  })

  it('notes still held when pedal lifts are not released', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100)
    va.setSustain(true)
    // No noteOff -> nothing latched -> lifting releases nothing.
    expect(va.setSustain(false)).toEqual([])
    expect(va.activeCount()).toBe(1)
  })

  it('noteOff without sustain releases immediately', () => {
    const va = new VoiceAllocator(4)
    const a = va.noteOn(60, 100)
    expect(va.noteOff(60)).toEqual([a.voiceIndex])
    expect(va.activeCount()).toBe(0)
  })

  it('retriggering a sustained note clears its sustained flag', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100)
    va.setSustain(true)
    va.noteOff(60) // now sustained
    va.noteOn(60, 120) // retrigger -> no longer just sustained
    const released = va.setSustain(false)
    // Pedal lift should NOT release 60 because it was retriggered (held again).
    expect(released).toEqual([])
    expect(va.velocityOf(60)).toBe(120)
  })

  it('noteOff of an unheld note returns []', () => {
    const va = new VoiceAllocator(4)
    expect(va.noteOff(99)).toEqual([])
  })
})

describe('panic', () => {
  it('returns all active voiceIndices and clears state', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100)
    va.noteOn(62, 100)
    va.noteOn(64, 100)
    const active = va.panic()
    expect(active.sort()).toEqual([0, 1, 2])
    expect(va.activeCount()).toBe(0)
    expect(va.velocityOf(60)).toBeUndefined()
  })

  it('clears sustain state so later noteOff releases immediately', () => {
    const va = new VoiceAllocator(4)
    va.noteOn(60, 100)
    va.setSustain(true)
    va.panic()
    const a = va.noteOn(70, 100)
    // sustain must have been cleared by panic
    expect(va.noteOff(70)).toEqual([a.voiceIndex])
  })

  it('resets age so the next note allocates fresh', () => {
    const va = new VoiceAllocator(2)
    va.noteOn(60, 100)
    va.noteOn(62, 100)
    va.panic()
    expect(va.noteOn(64, 100).stolen).toBe(false)
    expect(va.activeCount()).toBe(1)
  })
})
