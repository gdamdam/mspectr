// Scale quantization for the playable instrument. Pure + deterministic.
//
// We snap an arbitrary MIDI note to the nearest note that belongs to the given
// scale, relative to a chromatic root (0 = C). The mapping is octave-aware: the
// scale degrees repeat every 12 semitones, so the candidate set is effectively
// infinite and we only need to consider the two octaves bracketing the input.

import type { ScaleId } from '../audio/contracts'
import { SCALE_DEGREES } from '../audio/contracts'

/**
 * True when `note` is a member of `scale` relative to `root` (default C = 0).
 * Chromatic always returns true.
 */
export function isInScale(note: number, scale: ScaleId, root = 0): boolean {
  const degrees = SCALE_DEGREES[scale]
  // pitch class relative to the root, normalised to 0..11
  const pc = (((note - root) % 12) + 12) % 12
  return degrees.includes(pc)
}

/**
 * Snap `note` to the nearest in-scale MIDI note. `root` (default 0 = C) sets the
 * tonic the scale degrees are measured from. The search is octave-aware: scale
 * degrees recur every octave, so we compare the input against every degree in
 * the octave below, the current octave, and the octave above and keep the
 * closest candidate.
 *
 * Ties resolve downward (the lower note wins) per spec. Chromatic returns the
 * note unchanged (every semitone is in scale).
 */
export function quantizeNote(note: number, scale: ScaleId, root = 0): number {
  if (scale === 'chromatic') return note
  const degrees = SCALE_DEGREES[scale]

  // The octave (relative to root) that `note` sits in. floor handles negatives.
  const baseOctave = Math.floor((note - root) / 12)

  let best = note
  let bestDist = Infinity
  // -1..+1 octaves around the input covers every nearest candidate, since the
  // largest gap between adjacent scale degrees is well under 12 semitones.
  for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave++) {
    for (const degree of degrees) {
      const candidate = root + octave * 12 + degree
      const dist = Math.abs(candidate - note)
      // Strictly-less keeps the FIRST (lower, since we ascend) candidate on a
      // tie, so equidistant notes round down.
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
  }
  return best
}
