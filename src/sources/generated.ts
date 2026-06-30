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
 * harmonic-string: a plucked-string-like tone — a rich harmonic series whose
 * upper partials decay faster than the fundamental, with a slight inharmonic
 * detune on each partial, re-plucked twice across the loop with a gentle envelope.
 */
function renderHarmonicString(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 110 // A2
  const partials = 16
  // Fixed per-partial detune & phase from the seeded RNG (computed once).
  const detune = new Float32Array(partials)
  const phase = new Float32Array(partials)
  for (let h = 0; h < partials; h++) {
    detune[h] = 1 + (rng() - 0.5) * 0.004 * (h + 1) // inharmonic stretch grows with partial
    phase[h] = rng() * TWO_PI
  }
  const plucks = 2
  const pluckLen = length / plucks
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const tInPluck = (i % pluckLen) / sr
    let sample = 0
    for (let h = 0; h < partials; h++) {
      const freq = fundamental * (h + 1) * detune[h]
      // Higher partials decay faster — characteristic of a struck/plucked string.
      const decay = Math.exp(-tInPluck * (1.2 + h * 0.7))
      const amp = decay / (h + 1)
      sample += amp * Math.sin(TWO_PI * freq * t + phase[h])
    }
    // Soft attack on each pluck to avoid a click at the re-pluck point.
    const attack = 1 - Math.exp(-tInPluck * 400)
    data[i] = sample * attack
  }
  return data
}

/**
 * breath-choir: a filtered-noise vocal bed with a few vowel formant peaks and a
 * slow vibrato that slides the formant centres, giving an evolving choral pad.
 */
function renderBreathChoir(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  // Vowel-ish formant centres (Hz) with relative gains.
  const formants = [
    { f: 320, g: 1.0, q: 7 },
    { f: 800, g: 0.7, q: 9 },
    { f: 1200, g: 0.5, q: 11 },
    { f: 2600, g: 0.25, q: 13 },
  ]
  const filters = formants.map((fm) => makeBandpass(sr, fm.f, fm.q))
  const vibFilters = formants.map((fm) => makeBandpass(sr, fm.f * 1.5, fm.q))
  const vibratoHz = 0.7
  const vibratoDepth = 0.18
  // Pre-roll the filters with seeded noise so the state isn't a cold zero start
  // (keeps the loop head consistent with the steady-state body).
  for (let h = 0; h < formants.length; h++) {
    for (let k = 0; k < 256; k++) {
      const w = rng() * 2 - 1
      filters[h](w)
      vibFilters[h](w)
    }
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const white = rng() * 2 - 1
    // Vibrato as a slow crossfade between two detuned formant banks (cheap, stable).
    const vib = 0.5 + 0.5 * Math.sin(TWO_PI * vibratoHz * t)
    const blend = vibratoDepth * vib
    let sample = 0
    for (let h = 0; h < formants.length; h++) {
      const a = filters[h](white) * (1 - blend)
      const b = vibFilters[h](white) * blend
      sample += (a + b) * formants[h].g
    }
    // Slow amplitude swell so the pad evolves over the loop.
    const swell = 0.7 + 0.3 * Math.sin(TWO_PI * 0.15 * t)
    data[i] = sample * swell
  }
  return data
}

/**
 * metallic-strike: an inharmonic bell — partials at non-integer ratios with
 * exponential decay, struck repeatedly across the loop.
 */
function renderMetallicStrike(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const base = 220
  // Bell-like inharmonic ratios (roughly modelled on a struck bar/bell spectrum).
  const ratios = [1.0, 2.76, 5.4, 8.93, 13.34, 18.64]
  const partials = ratios.length
  const phase = new Float32Array(partials)
  const decayRate = new Float32Array(partials)
  for (let h = 0; h < partials; h++) {
    phase[h] = rng() * TWO_PI
    // Higher partials ring shorter; slight seeded variation per partial.
    decayRate[h] = 2.5 + h * 1.1 + rng() * 0.5
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
      sample += (env / (h + 1)) * Math.sin(TWO_PI * freq * t + phase[h])
    }
    const attack = 1 - Math.exp(-tInStrike * 2000)
    data[i] = sample * attack
  }
  return data
}

/**
 * noise-reed: band-passed noise with a couple of resonant harmonic peaks, giving
 * a buzzy sustained reed/oboe-like character.
 */
function renderNoiseReed(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 196 // G3
  // Two resonant band-passes on harmonics give the buzzy reed formant pair.
  const res1 = makeBandpass(sr, fundamental * 2, 14)
  const res2 = makeBandpass(sr, fundamental * 3, 18)
  const breath = makeBandpass(sr, fundamental * 6, 3)
  // Warm up filter state with seeded noise (avoid cold-start transient at head).
  for (let k = 0; k < 256; k++) {
    const w = rng() * 2 - 1
    res1(w)
    res2(w)
    breath(w)
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const white = rng() * 2 - 1
    // A faint sawtooth-ish drive at the fundamental reinforces the pitch sense.
    const drive = white * 0.6 + Math.sin(TWO_PI * fundamental * t) * 0.4
    const r1 = res1(drive) * 1.0
    const r2 = res2(drive) * 0.6
    const air = breath(white) * 0.15
    // Slow tremolo for a living sustained tone.
    const trem = 0.85 + 0.15 * Math.sin(TWO_PI * 5.5 * t)
    data[i] = (r1 + r2 + air) * trem
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
