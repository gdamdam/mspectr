import { describe, it, expect } from 'vitest'
import { quantizeNote, isInScale } from './scales'
import { SCALE_DEGREES } from '../audio/contracts'
import type { ScaleId } from '../audio/contracts'

describe('isInScale', () => {
  it('chromatic contains every note', () => {
    for (let n = 0; n < 12; n++) expect(isInScale(60 + n, 'chromatic')).toBe(true)
  })

  it('major scale membership relative to C', () => {
    // C D E F G A B in / C# D# F# G# A# out
    expect(isInScale(60, 'major')).toBe(true) // C
    expect(isInScale(61, 'major')).toBe(false) // C#
    expect(isInScale(62, 'major')).toBe(true) // D
    expect(isInScale(64, 'major')).toBe(true) // E
    expect(isInScale(65, 'major')).toBe(true) // F
    expect(isInScale(66, 'major')).toBe(false) // F#
  })

  it('respects a non-zero root', () => {
    // G major (root 7): F# is in scale, F natural is not.
    expect(isInScale(66, 'major', 7)).toBe(true) // F#
    expect(isInScale(65, 'major', 7)).toBe(false) // F
  })

  it('handles notes below the root (negative pitch class)', () => {
    expect(isInScale(48, 'major')).toBe(true) // C an octave down
    expect(isInScale(47, 'major')).toBe(true) // B
    expect(isInScale(46, 'major')).toBe(false) // A#
  })
})

describe('quantizeNote', () => {
  it('chromatic passes notes through unchanged', () => {
    for (let n = 50; n < 80; n++) expect(quantizeNote(n, 'chromatic')).toBe(n)
  })

  it('leaves in-scale notes untouched for every scale', () => {
    const scales = Object.keys(SCALE_DEGREES) as ScaleId[]
    for (const scale of scales) {
      for (const degree of SCALE_DEGREES[scale]) {
        const note = 60 + degree
        expect(quantizeNote(note, scale)).toBe(note)
      }
    }
  })

  it('snaps C# to nearest major-scale note (ties round down → C)', () => {
    // C#(61) is equidistant between C(60) and D(62). Tie → down → C.
    expect(quantizeNote(61, 'major')).toBe(60)
  })

  it('snaps F# up to G in major (closer to G)', () => {
    // F#(66): C/major degrees give F(65) and G(67), equidistant → tie → down → F.
    expect(quantizeNote(66, 'major')).toBe(65)
  })

  it('snaps unambiguous notes to the closer degree', () => {
    // minor scale from C: degrees 0,2,3,5,7,8,10. Note 61 (C#) -> nearest is C(60) or D(62)? tie -> 60.
    expect(quantizeNote(61, 'minor')).toBe(60)
    // pentatonic C: 0,2,4,7,9. Note 65 (F) nearest is E(64) or G(67) -> 64.
    expect(quantizeNote(65, 'pentatonic')).toBe(64)
    // dorian C: 0,2,3,5,7,9,10. Note 61 -> tie 60/62 -> 60.
    expect(quantizeNote(61, 'dorian')).toBe(60)
    // mixolydian C: 0,2,4,5,7,9,10. Note 63 (D#) nearest D(62) or E(64) -> tie -> 62.
    expect(quantizeNote(63, 'mixolydian')).toBe(62)
  })

  it('is octave-aware across boundaries', () => {
    // B(71) in C major is in scale -> unchanged.
    expect(quantizeNote(71, 'major')).toBe(71)
    // C#(73) in next octave -> tie C(72)/D(74) -> 72.
    expect(quantizeNote(73, 'major')).toBe(72)
  })

  it('quantizes correctly with a non-zero root', () => {
    // A minor (root 9): degrees relative to A. A(69) in scale.
    expect(quantizeNote(69, 'minor', 9)).toBe(69)
    // In A minor, A# (70) is not in scale; nearest A(69) or B(71) -> tie -> 69.
    expect(quantizeNote(70, 'minor', 9)).toBe(69)
  })

  it('output of quantizeNote is always in scale', () => {
    const scales = Object.keys(SCALE_DEGREES) as ScaleId[]
    for (const scale of scales) {
      for (let n = 40; n < 90; n++) {
        const q = quantizeNote(n, scale)
        expect(isInScale(q, scale)).toBe(true)
      }
    }
  })

  it('handles negative MIDI notes deterministically', () => {
    // Below C0; scale logic must not throw and must stay in scale.
    expect(isInScale(quantizeNote(-3, 'major'), 'major')).toBe(true)
  })
})
