/**
 * Four deterministic built-in source generators.
 *
 * Each source is synthesised entirely with seeded math (no Math.random / Date.now)
 * so the same id always yields bit-identical samples — required by determinism
 * tests and by the patch `seed` model in contracts.ts. Buffers are a few seconds
 * long, seamlessly loopable (a short equal-power crossfade folds the tail into the
 * head so the loop boundary neither clicks nor changes level), DC-removed, and
 * peak-normalised to ~-6 dBFS.
 *
 * Synthesis is direct (fill a Float32Array sample by sample) rather than via an
 * OfflineAudioContext, so it runs identically in node tests and in the browser
 * with no platform DSP variance.
 *
 * The handle/dispose lifecycle is adapted from mscope's input-source abstraction
 * (mscope/src/audio/input/GeneratorInput.ts + BaseInput.ts teardown ordering),
 * flattened into a one-shot SourceHandle.
 */

import type { GeneratedSourceId } from '../audio/contracts'
import type { SourceHandle } from './types'

// ---------------------------------------------------------------------------
// Deterministic RNG — mulberry32. Tiny, fast, well-distributed, fully seedable.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A per-source seed so each id gets a distinct but fixed deterministic stream. */
const SOURCE_SEEDS: Record<GeneratedSourceId, number> = {
  'harmonic-string': 0x9e3779b1,
  'breath-choir': 0x85ebca77,
  'metallic-strike': 0xc2b2ae3d,
  'noise-reed': 0x27d4eb2f,
}

const SOURCE_LABELS: Record<GeneratedSourceId, string> = {
  'harmonic-string': 'Harmonic String',
  'breath-choir': 'Breath Choir',
  'metallic-strike': 'Metallic Strike',
  'noise-reed': 'Noise Reed',
}

/** Default rendered length per source (seconds). Loopable as-is. */
const SOURCE_SECONDS: Record<GeneratedSourceId, number> = {
  'harmonic-string': 4,
  'breath-choir': 6,
  'metallic-strike': 4,
  'noise-reed': 4,
}

/** Target normalisation peak (~-6 dBFS). */
const TARGET_PEAK = 0.5 // 10^(-6/20) ≈ 0.501
/** Crossfade length used to make the loop boundary seamless (seconds). */
const LOOP_CROSSFADE_SECONDS = 0.05
const TWO_PI = Math.PI * 2
const PREVIEW_POINTS = 1024

// ---------------------------------------------------------------------------
// Shared post-processing
// ---------------------------------------------------------------------------

/** Subtract the mean so the buffer carries no DC offset. In place. */
function removeDc(data: Float32Array): void {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  const mean = sum / data.length
  if (mean === 0) return
  for (let i = 0; i < data.length; i++) data[i] -= mean
}

/**
 * Fold a short tail crossfade into the head so playback loops seamlessly: the
 * last `fade` samples are equal-power blended with the first `fade` samples and
 * written to the head, then the buffer is truncated by `fade`. This matches level
 * and phase trend across the boundary without an audible click.
 */
function applyLoopCrossfade(data: Float32Array, fade: number): Float32Array {
  if (fade <= 0 || fade * 2 >= data.length) return data
  const outLen = data.length - fade
  const out = new Float32Array(outLen)
  out.set(data.subarray(0, outLen))
  const tailStart = outLen // == data.length - fade
  for (let i = 0; i < fade; i++) {
    // Equal-power crossfade: head gain rises, tail gain falls.
    const t = (i + 0.5) / fade
    const headGain = Math.sin((t * Math.PI) / 2)
    const tailGain = Math.cos((t * Math.PI) / 2)
    out[i] = out[i] * headGain + data[tailStart + i] * tailGain
  }
  return out
}

/** Peak-normalise to TARGET_PEAK. In place; no-op for a silent buffer. */
function normalizePeak(data: Float32Array, target = TARGET_PEAK): void {
  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i])
    if (a > peak) peak = a
  }
  if (peak === 0) return
  const gain = target / peak
  for (let i = 0; i < data.length; i++) data[i] *= gain
}

/**
 * Decimate a mono channel down to ~PREVIEW_POINTS using per-bucket peak (max
 * absolute value, sign-preserving) so transients survive the downsample. Returns
 * a new Float32Array of length min(points, data.length).
 */
export function decimateWaveform(data: Float32Array, points = PREVIEW_POINTS): Float32Array {
  const n = Math.min(points, data.length)
  if (n === 0) return new Float32Array(0)
  const out = new Float32Array(n)
  const bucket = data.length / n
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.min(data.length, Math.floor((i + 1) * bucket))
    let peak = 0
    for (let j = start; j < end; j++) {
      if (Math.abs(data[j]) > Math.abs(peak)) peak = data[j]
    }
    out[i] = peak
  }
  return out
}

// ---------------------------------------------------------------------------
// One-pole helpers for noise-based sources
// ---------------------------------------------------------------------------

/**
 * A simple state-variable band-pass driven sample by sample. Resonant enough to
 * give noise a pitched character without ringing into instability. `f` is centre
 * frequency in Hz, `q` the resonance.
 */
function makeBandpass(sampleRate: number, f: number, q: number): (x: number) => number {
  const g = Math.tan((Math.PI * f) / sampleRate)
  const k = 1 / q
  const a1 = 1 / (1 + g * (g + k))
  const a2 = g * a1
  let ic1eq = 0
  let ic2eq = 0
  return function process(x: number): number {
    const v1 = a1 * ic1eq + a2 * (x - ic2eq)
    const v2 = ic2eq + g * v1
    ic1eq = 2 * v1 - ic1eq
    ic2eq = 2 * v2 - ic2eq
    return v1 // band-pass output
  }
}

// ---------------------------------------------------------------------------
// Per-source synthesis. Each returns a raw (pre-crossfade) mono Float32Array.
// ---------------------------------------------------------------------------

/**
 * harmonic-string: a bright, sustained bowed-string tone. A full harmonic series
 * (>20 partials) with a gentle high-frequency roll-off — but shaped so real energy
 * reaches well up the series (a soft "formant" bump around the 5th–9th partials,
 * as on a bowed violin/cello) rather than collapsing onto the fundamental. The
 * result sits clearly higher and brighter than a dull thud. Sustained (not
 * plucked): a slow bow swell and a subtle per-partial vibrato keep it alive and
 * seamlessly loopable.
 */
function renderHarmonicString(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 165 // ~E3 — higher than before so the whole series rides up
  const partials = 24
  const detune = new Float32Array(partials)
  const phase = new Float32Array(partials)
  const amp = new Float32Array(partials)
  for (let h = 0; h < partials; h++) {
    const n = h + 1
    // Slight seeded inharmonic stretch (string stiffness) — grows with partial.
    detune[h] = 1 + rng() * 0.0006 * n
    phase[h] = rng() * TWO_PI
    // Sawtooth-like 1/n base roll-off, but with a broad bowed-string formant bump
    // near the 6th partial so mid-high energy dominates → high centroid, bright.
    const rollOff = 1 / n
    const bump = 1 + 1.8 * Math.exp(-((n - 6) * (n - 6)) / 24)
    amp[h] = rollOff * bump
  }
  const vibHz = 4.5
  const vibDepth = 0.006 // ±0.6% pitch vibrato
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Slow bow swell over the whole loop keeps the sustain living.
    const swell = 0.85 + 0.15 * Math.sin(TWO_PI * 0.2 * t - Math.PI / 2)
    const vib = 1 + vibDepth * Math.sin(TWO_PI * vibHz * t)
    let sample = 0
    for (let h = 0; h < partials; h++) {
      const freq = fundamental * (h + 1) * detune[h] * vib
      sample += amp[h] * Math.sin(TWO_PI * freq * t + phase[h])
    }
    data[i] = sample * swell
  }
  return data
}

/**
 * breath-choir: the airy, high, breathy source — a wash of high-formant filtered
 * noise (the "ss/ff" air of a choir) sitting well above the other sources, with
 * only a faint tonal core for pitch. Deliberately the brightest/highest-centroid
 * source: emphasis on 2–5 kHz breath formants plus a broadband air shelf, so it
 * reads as "air and vowel" rather than a low hum.
 */
function renderBreathChoir(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  // High, breathy vowel formants — weighted toward the top so this is the
  // brightest source. Low first formant kept quiet so it does not sit on the string.
  const formants = [
    { f: 700, g: 0.35, q: 6 },
    { f: 1900, g: 0.9, q: 8 },
    { f: 2900, g: 1.0, q: 9 },
    { f: 4200, g: 0.85, q: 10 },
    { f: 6200, g: 0.6, q: 8 },
  ]
  const filters = formants.map((fm) => makeBandpass(sr, fm.f, fm.q))
  const vibFilters = formants.map((fm) => makeBandpass(sr, fm.f * 1.5, fm.q))
  // A broadband "air" high-pass-ish shelf via a wide top band-pass keeps the very
  // top alive so the centroid stays high after the engine's windowing.
  const air = makeBandpass(sr, 8500, 1.2)
  const vibratoHz = 0.6
  const vibratoDepth = 0.16
  // A quiet tonal core (soft sine at a mid pitch) gives just enough pitch sense.
  const coreHz = 330
  for (let h = 0; h < formants.length; h++) {
    for (let k = 0; k < 256; k++) {
      const w = rng() * 2 - 1
      filters[h](w)
      vibFilters[h](w)
      air(w)
    }
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const white = rng() * 2 - 1
    const vib = 0.5 + 0.5 * Math.sin(TWO_PI * vibratoHz * t)
    const blend = vibratoDepth * vib
    let sample = 0
    for (let h = 0; h < formants.length; h++) {
      const a = filters[h](white) * (1 - blend)
      const b = vibFilters[h](white) * blend
      sample += (a + b) * formants[h].g
    }
    sample += air(white) * 0.5 // top-end air
    sample += Math.sin(TWO_PI * coreHz * t) * 0.12 // faint tonal core
    const swell = 0.75 + 0.25 * Math.sin(TWO_PI * 0.13 * t)
    data[i] = sample * swell
  }
  return data
}

/**
 * metallic-strike: a bright, ringing inharmonic bell/bar. Non-integer partial
 * ratios (clearly NOT a harmonic series → distinct from the string), pitched a
 * good deal higher, with the upper partials carrying real sustained energy rather
 * than decaying instantly. Struck repeatedly across the loop, but each partial
 * rings long enough to keep the bell shimmering and bright.
 */
function renderMetallicStrike(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const base = 440 // an octave up from before — clearly higher than the string
  // Inharmonic bar/bell ratios, extended high so the bell is genuinely bright.
  const ratios = [1.0, 2.76, 5.4, 8.93, 13.34, 18.64, 24.1, 30.2]
  const partials = ratios.length
  const phase = new Float32Array(partials)
  const decayRate = new Float32Array(partials)
  const gain = new Float32Array(partials)
  for (let h = 0; h < partials; h++) {
    phase[h] = rng() * TWO_PI
    // Long, slow ring (bell-like) with only mild extra decay up the series, so the
    // bright partials survive → high, ringing centroid rather than a low clang.
    decayRate[h] = 0.8 + h * 0.35 + rng() * 0.3
    // Nearly flat gain across partials (a bell's upper modes stay loud).
    gain[h] = 1 / Math.sqrt(h + 1)
  }
  const strikes = 3
  const strikeLen = length / strikes
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const tInStrike = (i % strikeLen) / sr
    let sample = 0
    for (let h = 0; h < partials; h++) {
      const freq = base * ratios[h]
      const env = Math.exp(-tInStrike * decayRate[h])
      sample += gain[h] * env * Math.sin(TWO_PI * freq * t + phase[h])
    }
    const attack = 1 - Math.exp(-tInStrike * 2000)
    data[i] = sample * attack
  }
  return data
}

/**
 * noise-reed: a buzzy, dense, mid-high reed (oboe/harmonica-like). A bright
 * sawtooth drive (rich in odd+even harmonics) is passed through a stack of
 * resonant band-passes on the upper harmonics, so the tone is dense and buzzy and
 * sits in the mid-high band — clearly noisier/brighter than the string, but lower
 * and grittier than the airy choir. A little broadband reed "buzz" fills the gaps.
 */
function renderNoiseReed(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 262 // ~C4 — mid register
  // Resonant peaks on the upper harmonics give the dense, buzzy reed formants.
  const res = [
    { bp: makeBandpass(sr, fundamental * 3, 16), g: 1.0 },
    { bp: makeBandpass(sr, fundamental * 5, 18), g: 0.85 },
    { bp: makeBandpass(sr, fundamental * 7, 20), g: 0.7 },
    { bp: makeBandpass(sr, fundamental * 9, 22), g: 0.55 },
  ]
  const buzz = makeBandpass(sr, fundamental * 6, 2.5) // broadband reed rasp
  const nHarm = 14
  for (let r = 0; r < res.length; r++) {
    for (let k = 0; k < 256; k++) {
      const w = rng() * 2 - 1
      res[r].bp(w)
      buzz(w)
    }
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const white = rng() * 2 - 1
    // Bright band-limited sawtooth (sum of harmonics) — dense harmonic drive.
    let saw = 0
    for (let h = 1; h <= nHarm; h++) saw += Math.sin(TWO_PI * fundamental * h * t) / h
    const drive = saw * 0.6 + white * 0.5 // buzzy: tone + noise mixed
    let sample = 0
    for (let r = 0; r < res.length; r++) sample += res[r].bp(drive) * res[r].g
    sample += buzz(white) * 0.35
    const trem = 0.85 + 0.15 * Math.sin(TWO_PI * 5.5 * t)
    data[i] = sample * trem
  }
  return data
}

const RENDERERS: Record<GeneratedSourceId, (rng: () => number, sr: number, length: number) => Float32Array> = {
  'harmonic-string': renderHarmonicString,
  'breath-choir': renderBreathChoir,
  'metallic-strike': renderMetallicStrike,
  'noise-reed': renderNoiseReed,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the deterministic mono buffer for a built-in source as an AudioBuffer.
 * `seconds` overrides the default per-source length (used for previews/tests).
 * The same id (and seconds) always produces identical samples.
 */
export function renderGeneratedBuffer(
  ctx: BaseAudioContext,
  id: GeneratedSourceId,
  seconds?: number,
): AudioBuffer {
  const sr = ctx.sampleRate
  const targetSeconds = seconds ?? SOURCE_SECONDS[id]
  const fade = Math.round(LOOP_CROSSFADE_SECONDS * sr)
  // Render `fade` extra samples so the crossfade can fold the tail into the head
  // while still yielding a buffer of the requested length.
  const rawLength = Math.round(targetSeconds * sr) + fade
  const rng = mulberry32(SOURCE_SEEDS[id])

  let mono = RENDERERS[id](rng, sr, rawLength)
  removeDc(mono)
  mono = applyLoopCrossfade(mono, fade)
  removeDc(mono) // crossfade can reintroduce a tiny offset; re-centre.
  normalizePeak(mono)

  const buffer = ctx.createBuffer(1, mono.length, sr)
  buffer.getChannelData(0).set(mono)
  return buffer
}

/**
 * Create a started, looping source for a built-in generated buffer, wrapped as a
 * SourceHandle. The AudioBufferSourceNode is started immediately and loops; the
 * waveform preview is a decimated mono overview for secondary display.
 */
export function createGeneratedSource(ctx: AudioContext, id: GeneratedSourceId): SourceHandle {
  const buffer = renderGeneratedBuffer(ctx, id)
  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.loop = true
  node.start()

  const preview = decimateWaveform(buffer.getChannelData(0))

  let disposed = false
  return {
    id,
    kind: 'generated',
    label: SOURCE_LABELS[id],
    node,
    waveformPreview: preview,
    dispose(): void {
      if (disposed) return
      disposed = true
      try {
        node.stop()
      } catch {
        // start()/stop() already past; ignore.
      }
      node.disconnect()
    },
  }
}
