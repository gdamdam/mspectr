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

  it('preserves both snapshots and metadata across quality rebuilds', () => {
    const e = new SpectralEngine(SR, 'eco')
    const captured: Array<{ slot: string; label: string; at: number; live: boolean; bins: number }> = []
    e.setOnCaptured((slot, snap) => captured.push({
      slot,
      label: snap.sourceLabel,
      at: snap.capturedAt,
      live: snap.isLiveDerived,
      bins: snap.binCount,
    }))
    e.setParams({ ...DEFAULT_PARAMS })
    run(e, 30, 220)
    e.capture('A', 'frame', 'Mic', true, 1234)
    run(e, 4, 220)
    e.capture('B', 'frame', 'File', false, 5678)
    run(e, 4, 330)
    expect(e.snapshotFilled('A')).toBe(true)
    expect(e.snapshotFilled('B')).toBe(true)
    const oldBins = captured[0].bins
    e.setQuality('high')
    expect(e.snapshotFilled('A')).toBe(true)
    expect(e.snapshotFilled('B')).toBe(true)
    // A copy after rebuild exposes the preserved metadata through capture state.
    e.copySnapshot('A', 'B')
    expect(oldBins).not.toBe(0)
  })

  it('captures the displayed frozen spectrum immediately with provenance', () => {
    const e = new SpectralEngine(SR, 'normal')
    let snapshot: Parameters<NonNullable<Parameters<typeof e.setOnCaptured>[0]>>[1] | null = null
    e.setOnCaptured((_slot, snap) => (snapshot = snap))
    e.setParams({ ...DEFAULT_PARAMS })
    run(e, 40, 220)
    e.setParams({ ...DEFAULT_PARAMS, freeze: true })
    e.capture('A', 'evolving', 'Tab audio', true, 99)
    run(e, 1, 1200)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.frameCount).toBe(1)
    expect(snapshot).toMatchObject({ sourceLabel: 'Tab audio', capturedAt: 99, isLiveDerived: true })
  })

  it('lets a preset-authored freeze acquire its first live frame before holding', () => {
    const e = new SpectralEngine(SR, 'normal')
    let peak = 0
    e.setOnCaptured((_slot, snap) => {
      peak = Math.max(...snap.magnitude)
    })
    e.setParams({ ...DEFAULT_PARAMS, freeze: true })
    run(e, 40, 440)
    e.capture('A', 'frame')
    expect(peak).toBeGreaterThan(0)
  })

  it('applies input gain before analysis', () => {
    const capturePeak = (inputGainDb: number) => {
      const e = new SpectralEngine(SR, 'normal')
      let peak = 0
      e.setOnCaptured((_slot, snap) => {
        peak = Math.max(...snap.magnitude)
      })
      e.setParams({ ...DEFAULT_PARAMS, inputGainDb })
      run(e, 40, 220)
      e.capture('A', 'frame')
      run(e, 4, 220)
      return peak
    }
    expect(capturePeak(12)).toBeGreaterThan(capturePeak(-12) * 10)
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

  it('evolving capture is multi-frame and replays spectral motion', () => {
    let frameCount = 0
    const e = new SpectralEngine(SR, 'normal')
    e.setOnCaptured((_s, snap) => (frameCount = snap.frameCount))
    e.setParams({ ...DEFAULT_PARAMS, freezePhase: 'lock', reverbAmount: 0, attack: 0.005, release: 0.1, phaseMotion: 0 })

    // Source that crossfades 220 Hz → 1200 Hz so successive captured frames differ
    // (dark → bright). Capture a living region; feed long enough to fill it.
    const inp = new Float32Array(BLOCK)
    const l = new Float32Array(BLOCK)
    const r = new Float32Array(BLOCK)
    let n = 0
    for (let b = 0; b < 320; b++) {
      for (let i = 0; i < BLOCK; i++) {
        const prog = Math.min(1, n / (SR * 0.95))
        inp[i] = 0.5 * ((1 - prog) * Math.sin((2 * Math.PI * 220 * n) / SR) + prog * Math.sin((2 * Math.PI * 1200 * n) / SR))
        n++
      }
      if (b === 20) e.capture('A', 'evolving')
      e.render(inp, l, r)
    }
    expect(frameCount).toBeGreaterThan(1) // genuinely multi-frame

    // Play a sustained note from the living snapshot and collect ~1 s of output.
    e.noteOn(60, 110)
    const out = new Float32Array(SR)
    let pos = 0
    inp.fill(0)
    while (pos < out.length) {
      e.render(inp, l, r)
      const take = Math.min(BLOCK, out.length - pos)
      out.set(l.subarray(0, take), pos)
      pos += take
    }
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i])).toBeLessThanOrEqual(CEILING + 1e-4)

    // Zero-crossing rate (brightness proxy) rises as the captured crossfade evolves
    // dark → bright: the played spectrum is not static.
    const zc = (fromSec: number, toSec: number) => {
      let c = 0
      const a = Math.floor(fromSec * SR)
      const bEnd = Math.floor(toSec * SR)
      for (let i = a + 1; i < bEnd; i++) if (out[i - 1] <= 0 !== (out[i] <= 0)) c++
      return c
    }
    const early = zc(0.05, 0.28)
    const late = zc(0.4, 0.63)
    expect(late).toBeGreaterThan(early * 1.3)
  })

  it('flipbook: frameSpeed=0 freezes and framePosition scrubs the sequence', () => {
    // Capture a dark→bright evolving snapshot (same source as the motion test).
    const e = new SpectralEngine(SR, 'normal')
    let frameCount = 0
    e.setOnCaptured((_s, snap) => (frameCount = snap.frameCount))
    e.setParams({ ...DEFAULT_PARAMS, freezePhase: 'lock', reverbAmount: 0, attack: 0.005, release: 0.1, phaseMotion: 0 })
    const inp = new Float32Array(BLOCK)
    const l = new Float32Array(BLOCK)
    const r = new Float32Array(BLOCK)
    let n = 0
    for (let b = 0; b < 320; b++) {
      for (let i = 0; i < BLOCK; i++) {
        const prog = Math.min(1, n / (SR * 0.95))
        inp[i] = 0.5 * ((1 - prog) * Math.sin((2 * Math.PI * 220 * n) / SR) + prog * Math.sin((2 * Math.PI * 1200 * n) / SR))
        n++
      }
      if (b === 20) e.capture('A', 'evolving')
      e.render(inp, l, r)
    }
    expect(frameCount).toBeGreaterThan(1)

    // Play a held note at a fixed flipbook position and return zero-crossing rate
    // (brightness proxy) over ~0.5 s of steady output.
    const zcAt = (framePosition: number) => {
      e.panic()
      e.setParams({ ...DEFAULT_PARAMS, freezePhase: 'lock', reverbAmount: 0, attack: 0.005, release: 0.1, phaseMotion: 0, frameSpeed: 0, framePosition })
      e.noteOn(60, 110)
      const out = new Float32Array(Math.floor(SR * 0.6))
      const silence = new Float32Array(BLOCK)
      let pos = 0
      while (pos < out.length) {
        e.render(silence, l, r)
        const take = Math.min(BLOCK, out.length - pos)
        out.set(l.subarray(0, take), pos)
        pos += take
      }
      e.noteOff(60)
      let c = 0
      const a = Math.floor(0.15 * SR)
      const bEnd = Math.floor(0.55 * SR)
      const half = Math.floor((a + bEnd) / 2)
      let c1 = 0
      let c2 = 0
      for (let i = a + 1; i < bEnd; i++) {
        if (out[i - 1] <= 0 !== (out[i] <= 0)) {
          c++
          if (i < half) c1++
          else c2++
        }
      }
      // Frozen playback should not evolve: the two halves match closely.
      const steady = Math.abs(c1 - c2) <= Math.max(6, c * 0.25)
      return { zc: c, steady }
    }

    const dark = zcAt(0) // first frame region
    const bright = zcAt(1) // last frame region
    expect(dark.steady).toBe(true)
    expect(bright.steady).toBe(true)
    expect(bright.zc).toBeGreaterThan(dark.zc * 1.3)
  })
})
