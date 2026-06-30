import { describe, it, expect, beforeEach } from 'vitest'
import { QwertyKeyboard } from './keyboard'

interface Recorder {
  ons: Array<{ note: number; vel: number }>
  offs: number[]
  changes: number
}

function makeKb(baseNote?: number): { kb: QwertyKeyboard; rec: Recorder } {
  const rec: Recorder = { ons: [], offs: [], changes: 0 }
  const kb = new QwertyKeyboard({
    onNoteOn: (note, vel) => rec.ons.push({ note, vel }),
    onNoteOff: (note) => rec.offs.push(note),
    onChange: () => {
      rec.changes++
    },
    baseNote,
  })
  return { kb, rec }
}

describe('semitone mapping', () => {
  let kb: QwertyKeyboard
  let rec: Recorder
  beforeEach(() => {
    ;({ kb, rec } = makeKb())
    kb.setEnabled(true)
    rec.changes = 0 // ignore the enable change
  })

  it('defaults baseNote to 48 (C3)', () => {
    expect(kb.getRootNote()).toBe(48)
  })

  it("maps 'a' to the root note", () => {
    kb.handleKeyDown('a')
    expect(rec.ons).toEqual([{ note: 48, vel: 100 }])
  })

  it('maps the full one-octave white/black row', () => {
    const keys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j']
    keys.forEach((k) => kb.handleKeyDown(k))
    expect(rec.ons.map((o) => o.note)).toEqual([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59])
  })

  it('maps the upper-row keys k o l p ;', () => {
    ;['k', 'o', 'l', 'p', ';'].forEach((k) => kb.handleKeyDown(k))
    expect(rec.ons.map((o) => o.note)).toEqual([60, 61, 62, 63, 64])
  })

  it('is case-insensitive', () => {
    kb.handleKeyDown('A')
    expect(rec.ons).toEqual([{ note: 48, vel: 100 }])
  })

  it('honors a custom baseNote', () => {
    const { kb: k2, rec: r2 } = makeKb(60)
    k2.setEnabled(true)
    expect(k2.getRootNote()).toBe(60)
    k2.handleKeyDown('a')
    expect(r2.ons[0].note).toBe(60)
  })

  it('key-up releases the exact note that was started', () => {
    kb.handleKeyDown('a')
    kb.handleKeyUp('a')
    expect(rec.offs).toEqual([48])
  })

  it('ignores unmapped keys', () => {
    expect(kb.handleKeyDown('q')).toBe(false)
    expect(rec.ons).toEqual([])
  })
})

describe('disabled keyboard', () => {
  it('does nothing while disabled', () => {
    const { kb, rec } = makeKb()
    expect(kb.handleKeyDown('a')).toBe(false)
    expect(rec.ons).toEqual([])
  })

  it('releases held notes when disabled mid-play', () => {
    const { kb, rec } = makeKb()
    kb.setEnabled(true)
    kb.handleKeyDown('a')
    kb.setEnabled(false)
    expect(rec.offs).toEqual([48])
  })
})

describe('octave shift', () => {
  let kb: QwertyKeyboard
  let rec: Recorder
  beforeEach(() => {
    ;({ kb, rec } = makeKb())
    kb.setEnabled(true)
  })

  it('z/x move the octave down/up by 12 semitones', () => {
    kb.handleKeyDown('x')
    expect(kb.getOctaveShift()).toBe(1)
    kb.handleKeyDown('a')
    expect(rec.ons[0].note).toBe(60)
    rec.offs = []
    kb.handleKeyUp('a')
    kb.handleKeyDown('z')
    kb.handleKeyDown('z')
    expect(kb.getOctaveShift()).toBe(-1)
    kb.handleKeyDown('a')
    expect(rec.ons[rec.ons.length - 1].note).toBe(36)
  })

  it('clamps octave shift to +/-4', () => {
    for (let i = 0; i < 10; i++) kb.handleKeyDown('x')
    expect(kb.getOctaveShift()).toBe(4)
    for (let i = 0; i < 20; i++) kb.handleKeyDown('z')
    expect(kb.getOctaveShift()).toBe(-4)
  })

  it('releases held notes when the octave changes', () => {
    kb.handleKeyDown('a') // note 48 sounding
    rec.offs = []
    kb.handleKeyDown('x') // octave up -> must release the held note
    expect(rec.offs).toEqual([48])
    expect(kb.getOctaveShift()).toBe(1)
  })

  it('does not release or fire onChange when octave is already at the bound', () => {
    for (let i = 0; i < 4; i++) kb.handleKeyDown('x')
    kb.handleKeyDown('a')
    rec.offs = []
    rec.changes = 0
    kb.handleKeyDown('x') // already at +4 -> no-op
    expect(rec.offs).toEqual([])
    expect(rec.changes).toBe(0)
    expect(kb.getOctaveShift()).toBe(4)
  })
})

describe('velocity control', () => {
  let kb: QwertyKeyboard
  let rec: Recorder
  beforeEach(() => {
    ;({ kb, rec } = makeKb())
    kb.setEnabled(true)
  })

  it('c/v decrement/increment velocity by 12', () => {
    expect(kb.getVelocity()).toBe(100)
    kb.handleKeyDown('v')
    expect(kb.getVelocity()).toBe(112)
    kb.handleKeyDown('c')
    expect(kb.getVelocity()).toBe(100)
  })

  it('applies the current velocity to new notes', () => {
    kb.handleKeyDown('c') // 88
    kb.handleKeyDown('a')
    expect(rec.ons[0].vel).toBe(88)
  })

  it('clamps velocity to [1, 127]', () => {
    for (let i = 0; i < 20; i++) kb.handleKeyDown('v')
    expect(kb.getVelocity()).toBe(127)
    for (let i = 0; i < 30; i++) kb.handleKeyDown('c')
    expect(kb.getVelocity()).toBe(1)
  })
})

describe('auto-repeat handling', () => {
  let kb: QwertyKeyboard
  let rec: Recorder
  beforeEach(() => {
    ;({ kb, rec } = makeKb())
    kb.setEnabled(true)
  })

  it('ignores OS auto-repeat for note keys (no double note-on)', () => {
    kb.handleKeyDown('a', false)
    kb.handleKeyDown('a', true) // auto-repeat
    kb.handleKeyDown('a', true)
    expect(rec.ons).toEqual([{ note: 48, vel: 100 }])
  })

  it('ignores a second physical-style press while already sounding', () => {
    kb.handleKeyDown('a')
    kb.handleKeyDown('a') // repeat flag false but already held
    expect(rec.ons.length).toBe(1)
  })

  it('ignores auto-repeat for octave keys (one step per press)', () => {
    kb.handleKeyDown('x', false)
    kb.handleKeyDown('x', true)
    kb.handleKeyDown('x', true)
    expect(kb.getOctaveShift()).toBe(1)
  })

  it('ignores auto-repeat for velocity keys', () => {
    kb.handleKeyDown('v', false)
    kb.handleKeyDown('v', true)
    expect(kb.getVelocity()).toBe(112)
  })
})

describe('releaseAll', () => {
  it('releases every sounding note and clears state', () => {
    const { kb, rec } = makeKb()
    kb.setEnabled(true)
    kb.handleKeyDown('a')
    kb.handleKeyDown('s')
    rec.offs = []
    kb.releaseAll()
    expect(rec.offs.sort((a, b) => a - b)).toEqual([48, 50])
    // A subsequent key-up for an already-released key should be a no-op note-off.
    rec.offs = []
    kb.handleKeyUp('a')
    expect(rec.offs).toEqual([])
  })
})
