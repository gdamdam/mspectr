import { describe, expect, it } from 'vitest'
import { StereoReverb } from './reverb'

describe('StereoReverb safety and independent early reflections', () => {
  it('produces early reflections when the tail amount is zero', () => {
    const reverb = new StereoReverb(8000)
    reverb.amount = 0
    reverb.early = 1
    const left = new Float32Array(512)
    const right = new Float32Array(512)
    left[0] = 1
    right[0] = 1
    reverb.process(left, right)
    expect(Math.max(...left.subarray(2))).toBeGreaterThan(0)
  })

  it('does not let non-finite input poison later comb state', () => {
    const reverb = new StereoReverb(48000)
    const left = new Float32Array(2048)
    const right = new Float32Array(2048)
    left[0] = Number.NaN
    right[1] = Number.POSITIVE_INFINITY
    reverb.process(left, right)
    const nextL = new Float32Array(2048)
    const nextR = new Float32Array(2048)
    reverb.process(nextL, nextR)
    for (const sample of [...nextL, ...nextR]) expect(Number.isFinite(sample)).toBe(true)
  })
})
