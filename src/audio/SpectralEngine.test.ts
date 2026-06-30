import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, dbToGain, type SpectralParams } from './contracts'
import { SpectralEngine } from './SpectralEngine'

const SR = 48000
const BLOCK = 128
const CEILING = dbToGain(-1)

/** Run the engine for `blocks` render quanta, feeding a steady sine, return peak + rms of output. */
function run(engine: SpectralEngine, blocks: number, freq = 220, startSample = 0) {
  const inp = new Float32Array(BLOCK)
  const l = new Float32Array(BLOCK)
  const r = new Float32Array(BLOCK)
  let peak = 0
  let sumSq = 0
  let count = 0
  let t = startSample
  for (let blk = 0; blk < blocks; blk++) {
    for (let i = 0; i < BLOCK; i++) {
      inp[i] = 0.6 * Math.sin((2 * Math.PI * freq * t) / SR)
      t++
    }
    engine.render(inp, l, r)
    for (let i = 0; i < BLOCK; i++) {
      peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
      sumSq += l[i] * l[i] + r[i] * r[i]
      count += 2
      expect(Number.isFinite(l[i])).toBe(true)
      expect(Number.isFinite(r[i])).toBe(true)
    }
  }
  return { peak, rms: Math.sqrt(sumSq / count), endSample: t }
}

describe('SpectralEngine', () => {
  it('warms up to silence with no notes', () => {
    const e = new SpectralEngine(SR, 'normal')
    e.setParams({ ...DEFAULT_PARAMS })
    const { rms } = run(e, 40)
    expect(rms).toBeLessThan(1e-3)
  })

  it('plays a captured spectrum, then decays on note-off and silences on panic', () => {
    const e = new SpectralEngine(SR, 'normal')
    e.setParams({ ...DEFAULT_PARAMS, reverbAmount: 0, attack: 0.005, release: 0.05 })
    run(e, 40, 220) // fill analyzer with a tone
    e.capture('A', 'frame')
    run(e, 4, 220)
    expect(e.snapshotFilled('A')).toBe(true)

    e.noteOn(60, 110)
    const playing = run(e, 60, 220)
    expect(playing.rms).toBeGreaterThan(1e-3)
    expect(playing.peak).toBeLessThanOrEqual(CEILING + 1e-4)

    e.noteOff(60)
    run(e, 200) // let the release finish
    const after = run(e, 40)
    expect(after.rms).toBeLessThan(1e-2)

    e.noteOn(64, 110)
    run(e, 20)
    e.panic()
    const silenced = run(e, 40)
    expect(silenced.rms).toBeLessThan(1e-3)
  })

  it('stays finite and within the ceiling under extreme controls', () => {
    const e = new SpectralEngine(SR, 'high')
    const extreme: SpectralParams = {
      ...DEFAULT_PARAMS,
      morph: 0.5,
      shift: 24,
      formant: 24,
      blur: 1,
      tilt: 1,
      gate: 0.9,
      harmonyVoices: 4,
      harmonyInterval: 'shimmer',
      harmonyMix: 1,
      phaseMotion: 1,
      reverbAmount: 1,
      diffusion: 1,
      stereoWidth: 1,
      outputGainDb: 24,
    }
    e.setParams(extreme)
    e.setPolyphony(8)
    run(e, 40, 110)
    e.capture('A', 'average')
    run(e, 10, 110)
    // Pile on the whole polyphony.
    for (const note of [48, 52, 55, 60, 64, 67, 72, 76]) e.noteOn(note, 127)
    e.pitchBend(2)
    const loud = run(e, 80, 110)
    expect(loud.peak).toBeLessThanOrEqual(CEILING + 1e-4)
  })

  it('captures deterministically from identical input', () => {
    const e1 = new SpectralEngine(SR, 'normal')
    const e2 = new SpectralEngine(SR, 'normal')
    let capA: Float32Array | null = null
    let capB: Float32Array | null = null
    e1.setOnCaptured((_s, snap) => (capA = snap.magnitude))
    e2.setOnCaptured((_s, snap) => (capB = snap.magnitude))
    e1.setParams({ ...DEFAULT_PARAMS })
    e2.setParams({ ...DEFAULT_PARAMS })
    run(e1, 40, 330)
    run(e2, 40, 330)
    e1.capture('A', 'frame')
    e2.capture('A', 'frame')
    run(e1, 4, 330)
    run(e2, 4, 330)
    expect(capA).not.toBeNull()
    expect(capB).not.toBeNull()
    expect(Array.from(capA!)).toEqual(Array.from(capB!))
  })

  it('rebuilds cleanly across quality changes without NaN', () => {
    const e = new SpectralEngine(SR, 'eco')
    e.setParams({ ...DEFAULT_PARAMS })
    run(e, 20, 200)
    e.setQuality('high')
    e.noteOn(60, 100)
    const out = run(e, 40, 200)
    expect(Number.isFinite(out.peak)).toBe(true)
    expect(out.peak).toBeLessThanOrEqual(CEILING + 1e-4)
  })

  it('auditions a captured snapshot without a note and stops on null', () => {
    const e = new SpectralEngine(SR, 'normal')
    e.setParams({ ...DEFAULT_PARAMS, reverbAmount: 0, attack: 0.005, release: 0.05 })
    run(e, 40, 220)
    e.capture('A', 'frame')
    run(e, 4, 220)
    expect(e.snapshotFilled('A')).toBe(true)

    // No note held — audition must still sound, and stay within the ceiling.
    e.audition('A')
    const auditioning = run(e, 60, 220)
    expect(auditioning.rms).toBeGreaterThan(1e-3)
    expect(auditioning.peak).toBeLessThanOrEqual(CEILING + 1e-4)

    // Stopping audition decays to silence.
    e.audition(null)
    run(e, 300, 220)
    const after = run(e, 40, 220)
    expect(after.rms).toBeLessThan(1e-2)
  })
})
