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
  'glass-harmonica': 0x165667b1,
  'singing-bowl': 0xd3a2646d,
  'brass-swell': 0xfd7046c5,
  'vowel-voice': 0xb55a4f09,
  'reed-organ': 0x1b873593,
  'fm-bell': 0xcc9e2d51,
  gong: 0xa2b8d3f1,
  'bowed-metal': 0x7feb352d,
  tanpura: 0x846ca68b,
  'air-pad': 0xff51afd7,
}

const SOURCE_LABELS: Record<GeneratedSourceId, string> = {
  'harmonic-string': 'Harmonic String',
  'breath-choir': 'Breath Choir',
  'metallic-strike': 'Metallic Strike',
  'noise-reed': 'Noise Reed',
  'glass-harmonica': 'Glass Harmonica',
  'singing-bowl': 'Singing Bowl',
  'brass-swell': 'Brass Swell',
  'vowel-voice': 'Vowel Voice',
  'reed-organ': 'Reed Organ',
  'fm-bell': 'FM Bell',
  gong: 'Gong',
  'bowed-metal': 'Bowed Metal',
  tanpura: 'Tanpura',
  'air-pad': 'Air Pad',
}

/** Default rendered length per source (seconds). Loopable as-is. */
const SOURCE_SECONDS: Record<GeneratedSourceId, number> = {
  'harmonic-string': 4,
  'breath-choir': 6,
  'metallic-strike': 4,
  'noise-reed': 4,
  'glass-harmonica': 6,
  'singing-bowl': 8,
  'brass-swell': 6,
  'vowel-voice': 6,
  'reed-organ': 5,
  'fm-bell': 5,
  gong: 8,
  'bowed-metal': 7,
  tanpura: 6,
  'air-pad': 8,
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

function sanitizeFinite(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) data[i] = 0
  }
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
  const safeRate = Math.max(1000, Number.isFinite(sampleRate) ? sampleRate : 44100)
  const safeFrequency = Math.max(1, Math.min(f, safeRate * 0.45))
  const safeQ = Math.max(0.05, Number.isFinite(q) ? q : 1)
  const g = Math.tan((Math.PI * safeFrequency) / safeRate)
  const k = 1 / safeQ
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

/**
 * glass-harmonica: rubbed wine glasses. Nearly-pure high sine partials (a weak,
 * slightly-inharmonic overtone or two) with several very slow beat pairs — each
 * partial is split into two detuned sines a fraction of a Hz apart so the whole
 * spectrum shimmers and slowly breathes. Very tonal, bright, glassy.
 */
function renderGlassHarmonica(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 660 // ~E5 — high and pure
  // Glass rings almost sinusoidally; a couple of weak, slightly stretched overtones.
  const partials = [
    { ratio: 1.0, g: 1.0 },
    { ratio: 2.005, g: 0.28 },
    { ratio: 3.02, g: 0.12 },
    { ratio: 4.04, g: 0.05 },
  ]
  const n = partials.length
  const phaseA = new Float32Array(n)
  const phaseB = new Float32Array(n)
  const beatHz = new Float32Array(n)
  for (let h = 0; h < n; h++) {
    phaseA[h] = rng() * TWO_PI
    phaseB[h] = rng() * TWO_PI
    // Sub-Hz beating between the two halves of each partial → slow shimmer.
    beatHz[h] = 0.15 + rng() * 0.55
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Very gentle overall breathing as the finger pressure varies.
    const swell = 0.88 + 0.12 * Math.sin(TWO_PI * 0.08 * t)
    let sample = 0
    for (let h = 0; h < n; h++) {
      const f = fundamental * partials[h].ratio
      const a = Math.sin(TWO_PI * f * t + phaseA[h])
      const b = Math.sin(TWO_PI * (f + beatHz[h]) * t + phaseB[h])
      sample += partials[h].g * (a + b) * 0.5
    }
    data[i] = sample * swell
  }
  return data
}

/**
 * singing-bowl: a struck/sustained metal bowl. A low fundamental plus a handful
 * of INHARMONIC partials (bell-like non-integer ratios), each split into a close
 * beating pair so the partials audibly beat against one another with a long, slow
 * evolution. Low centroid, tonal-but-metallic — clearly distinct from the higher,
 * purer glass and the harmonic string.
 */
function renderSingingBowl(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const base = 196 // ~G3 low bowl fundamental
  // Inharmonic bowl modes (not a harmonic series) — a few, richly beating.
  const modes = [
    { ratio: 1.0, g: 1.0, beat: 0.5 },
    { ratio: 2.71, g: 0.55, beat: 0.9 },
    { ratio: 5.18, g: 0.35, beat: 1.4 },
    { ratio: 8.61, g: 0.18, beat: 2.1 },
  ]
  const n = modes.length
  const phaseA = new Float32Array(n)
  const phaseB = new Float32Array(n)
  const depth = new Float32Array(n)
  for (let h = 0; h < n; h++) {
    phaseA[h] = rng() * TWO_PI
    phaseB[h] = rng() * TWO_PI
    depth[h] = 0.6 + rng() * 0.4 // per-mode beat depth
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Slow overall evolution as the bowl energy redistributes.
    const swell = 0.8 + 0.2 * Math.sin(TWO_PI * 0.05 * t - Math.PI / 3)
    let sample = 0
    for (let h = 0; h < n; h++) {
      const f = base * modes[h].ratio
      // Amplitude beating from the interference of the two close partials.
      const beatAmp = 1 - depth[h] * 0.5 * (1 - Math.cos(TWO_PI * modes[h].beat * t))
      const a = Math.sin(TWO_PI * f * t + phaseA[h])
      const b = Math.sin(TWO_PI * (f + modes[h].beat) * t + phaseB[h])
      sample += modes[h].g * beatAmp * (a + b) * 0.5
    }
    data[i] = sample * swell
  }
  return data
}

/**
 * brass-swell: a rich harmonic brass tone. Many strong harmonics whose relative
 * balance is driven by a slowly-swelling bright formant that sweeps up the series
 * (as brass brightens when it gets louder), so the timbre morphs over the loop.
 * Fully harmonic → great for harmonize/pitch, with a moving centroid.
 */
function renderBrassSwell(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 147 // ~D3 — brassy low-mid
  const partials = 20
  const phase = new Float32Array(partials)
  const detune = new Float32Array(partials)
  for (let h = 0; h < partials; h++) {
    phase[h] = rng() * TWO_PI
    detune[h] = 1 + (rng() * 2 - 1) * 0.0008 // tiny ensemble spread
  }
  const swellHz = 0.12
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Slow crescendo; brightness (formant centre partial) tracks the swell.
    const swell = 0.6 + 0.4 * (0.5 - 0.5 * Math.cos(TWO_PI * swellHz * t))
    const formantCenter = 3 + 9 * swell // moves from ~3rd to ~12th partial
    const formantWidth = 5
    const vib = 1 + 0.004 * Math.sin(TWO_PI * 5.2 * t)
    let sample = 0
    for (let h = 0; h < partials; h++) {
      const nn = h + 1
      const freq = fundamental * nn * detune[h] * vib
      // 1/n base plus a broad moving brightness bump → sweeping bright formant.
      const bump = Math.exp(-((nn - formantCenter) * (nn - formantCenter)) / (2 * formantWidth * formantWidth))
      const amp = (1 / nn) * (0.4 + 1.6 * bump)
      sample += amp * Math.sin(TWO_PI * freq * t + phase[h])
    }
    data[i] = sample * swell
  }
  return data
}

/**
 * vowel-voice: a sung vowel. A buzzy band-limited glottal pulse (rich harmonic
 * source) driven through 3–4 resonant vocal FORMANTS whose centre frequencies
 * slowly morph between an "aah" and an "ooh", so the spectral envelope moves while
 * the pitch stays fixed. Formant-rich — ideal for the formant control.
 */
function renderVowelVoice(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 174 // ~F3 sung pitch
  // Formant targets: aah (open) ↔ ooh (rounded). [F1..F4] in Hz.
  const aah = [800, 1150, 2900, 3900]
  const ooh = [325, 700, 2530, 3500]
  const gains = [1.0, 0.7, 0.35, 0.2]
  const qs = [10, 11, 12, 12]
  const nf = gains.length
  const filters = aah.map((_, k) => makeBandpass(sr, aah[k], qs[k]))
  // Precompute the buzzy glottal drive as a band-limited sum of harmonics.
  const nHarm = 30
  const phase = new Float32Array(nHarm)
  for (let h = 0; h < nHarm; h++) phase[h] = rng() * TWO_PI
  const morphHz = 0.11
  const vibHz = 5.0
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const vib = 1 + 0.005 * Math.sin(TWO_PI * vibHz * t)
    // Glottal-ish drive: -6 dB/oct harmonic series (1/n) → buzzy but not harsh.
    let drive = 0
    for (let h = 1; h <= nHarm; h++) {
      drive += Math.sin(TWO_PI * fundamental * h * vib * t + phase[h - 1]) / h
    }
    // Slowly morph formant centres aah↔ooh. Recreate filters only occasionally
    // would drift state; instead we drive fixed filters but blend two vowel taps.
    const m = 0.5 - 0.5 * Math.cos(TWO_PI * morphHz * t) // 0..1 aah→ooh→aah
    let sample = 0
    for (let k = 0; k < nf; k++) {
      const center = aah[k] + (ooh[k] - aah[k]) * m
      // Re-tune a lightweight resonator by weighting the fixed band-pass output
      // with a Gaussian around the moving centre (cheap moving-formant emphasis).
      const y = filters[k](drive)
      const closeness = Math.exp(-((center - aah[k]) * (center - aah[k])) / (2 * 400 * 400))
      sample += y * gains[k] * (0.5 + 0.5 * closeness)
    }
    const breath = 0.9 + 0.1 * Math.sin(TWO_PI * 0.3 * t)
    data[i] = sample * breath
  }
  return data
}

/**
 * reed-organ: harmonium / pump-organ. A dense sustained tone with strong odd AND
 * even harmonics (square-ish + saw blend), lightly detuned across two ranks for a
 * reedy chorus, with a gentle tremolo. Mid centroid, thick and stable.
 */
function renderReedOrgan(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 220 // ~A3
  const nHarm = 18
  const phaseA = new Float32Array(nHarm)
  const phaseB = new Float32Array(nHarm)
  const amp = new Float32Array(nHarm)
  for (let h = 0; h < nHarm; h++) {
    const nn = h + 1
    phaseA[h] = rng() * TWO_PI
    phaseB[h] = rng() * TWO_PI
    // Dense odd+even content: gentle roll-off with a reedy mid emphasis.
    const reed = 1 + 0.6 * Math.exp(-((nn - 5) * (nn - 5)) / 18)
    amp[h] = (1 / Math.sqrt(nn)) * reed
  }
  const detune = 1.004 // second rank slightly sharp → reedy chorus
  const tremHz = 4.2
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const trem = 0.9 + 0.1 * Math.sin(TWO_PI * tremHz * t)
    let sample = 0
    for (let h = 0; h < nHarm; h++) {
      const nn = h + 1
      const f = fundamental * nn
      sample += amp[h] * Math.sin(TWO_PI * f * t + phaseA[h])
      sample += amp[h] * 0.8 * Math.sin(TWO_PI * f * detune * t + phaseB[h])
    }
    data[i] = sample * trem
  }
  return data
}

/**
 * fm-bell: a clangorous FM bell. A single carrier/modulator FM pair with a
 * non-integer modulation ratio produces inharmonic sidebands; a slowly decaying
 * modulation index makes the metallic sheen bloom then settle, re-struck across
 * the loop. Dense inharmonic partials → great for spectral shift.
 */
function renderFmBell(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const carrier = 392 // ~G4
  const modRatio = 1.414 // irrational-ish → inharmonic sidebands
  const modFreq = carrier * modRatio
  const cPhase = rng() * TWO_PI
  const mPhase = rng() * TWO_PI
  const strikes = 2
  const strikeLen = length / strikes
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const tInStrike = (i % strikeLen) / sr
    // Modulation index decays from a bright clang to a purer ring.
    const index = 6 * Math.exp(-tInStrike * 1.2)
    const env = Math.exp(-tInStrike * 1.6)
    const mod = index * Math.sin(TWO_PI * modFreq * t + mPhase)
    const sample = env * Math.sin(TWO_PI * carrier * t + cPhase + mod)
    const attack = 1 - Math.exp(-tInStrike * 1500)
    data[i] = sample * attack
  }
  return data
}

/**
 * gong: a tam-tam wash. Dense inharmonic energy spread broadly across the
 * spectrum — many closely-spaced randomly-detuned partials plus filtered noise —
 * with a slow build-and-shimmer as high modes bloom over time. Bright, dense,
 * broadband and evolving.
 */
function renderGong(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const base = 110 // low anchor; energy spreads far above it
  const nModes = 48
  const freq = new Float32Array(nModes)
  const phase = new Float32Array(nModes)
  const gain = new Float32Array(nModes)
  const bloomHz = new Float32Array(nModes)
  for (let h = 0; h < nModes; h++) {
    // Dense, irregular inharmonic spread from ~base up to several kHz.
    freq[h] = base * (1 + h * 0.9 + rng() * 0.7)
    phase[h] = rng() * TWO_PI
    gain[h] = (0.5 + rng() * 0.5) / Math.sqrt(h + 1)
    // Each mode shimmers on its own slow LFO → wash never sits still.
    bloomHz[h] = 0.05 + rng() * 0.4
  }
  // Broadband metallic noise bed via a high band-pass.
  const noiseBp = makeBandpass(sr, 3200, 1.1)
  for (let k = 0; k < 256; k++) noiseBp(rng() * 2 - 1)
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Slow overall build then sustain-shimmer over the loop.
    const build = 0.55 + 0.45 * (0.5 - 0.5 * Math.cos(TWO_PI * 0.06 * t))
    let sample = 0
    for (let h = 0; h < nModes; h++) {
      const shimmer = 0.6 + 0.4 * Math.sin(TWO_PI * bloomHz[h] * t + phase[h])
      sample += gain[h] * shimmer * Math.sin(TWO_PI * freq[h] * t + phase[h])
    }
    sample += noiseBp(rng() * 2 - 1) * 0.6
    data[i] = sample * build
  }
  return data
}

/**
 * bowed-metal: a bowed cymbal / metal plate. An eerie evolving inharmonic sustain
 * where upper overtones slowly RISE in amplitude over the loop (as sustained
 * bowing excites higher modes), so the centroid climbs and the timbre grows
 * brighter and more shrill. Inharmonic ratios keep it clearly non-tonal.
 */
function renderBowedMetal(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const base = 233 // ~Bb3
  // Inharmonic plate/cymbal ratios, biased toward the upper spectrum.
  const ratios = [1.0, 2.41, 3.83, 5.29, 7.12, 9.4, 12.1, 15.3]
  const n = ratios.length
  const phase = new Float32Array(n)
  const beat = new Float32Array(n)
  for (let h = 0; h < n; h++) {
    phase[h] = rng() * TWO_PI
    beat[h] = 0.3 + rng() * 1.2 // slow amplitude beating per mode
  }
  const riseHz = 0.07
  for (let i = 0; i < length; i++) {
    const t = i / sr
    // Upper overtones rise over the loop → climbing brightness.
    const rise = 0.5 - 0.5 * Math.cos(TWO_PI * riseHz * t)
    let sample = 0
    for (let h = 0; h < n; h++) {
      const f = base * ratios[h]
      // Higher modes weighted more as `rise` grows → moving centroid.
      const weight = (1 / Math.sqrt(h + 1)) * (0.4 + 1.6 * rise * (h / n))
      const wobble = 0.7 + 0.3 * Math.sin(TWO_PI * beat[h] * t + phase[h])
      sample += weight * wobble * Math.sin(TWO_PI * f * t + phase[h])
    }
    data[i] = sample
  }
  return data
}

/**
 * tanpura: a sympathetic-string drone. A rich harmonic series whose upper
 * harmonics are strongly emphasised and slowly swept by a moving resonance — the
 * characteristic "jvari" buzz produced by the thread on the bridge. Repeatedly
 * plucked strings overlap into a shimmering, slowly-evolving harmonic drone.
 */
function renderTanpura(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  const fundamental = 131 // ~C3 drone (Pa/Sa string)
  const partials = 28
  const phase = new Float32Array(partials)
  for (let h = 0; h < partials; h++) phase[h] = rng() * TWO_PI
  // Slowly-sweeping jvari resonance emphasising the buzzing upper harmonics.
  const jvariHz = 0.09
  const plucks = 4
  const pluckLen = length / plucks
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const tInPluck = (i % pluckLen) / sr
    // Each pluck decays slowly; overlapping plucks keep the drone alive.
    const pluckEnv = 0.4 + 0.6 * Math.exp(-tInPluck * 0.9)
    // Moving resonance centre (in harmonic index) creates the jvari sweep.
    const resCenter = 8 + 8 * (0.5 - 0.5 * Math.cos(TWO_PI * jvariHz * t))
    const resWidth = 6
    let sample = 0
    for (let h = 0; h < partials; h++) {
      const nn = h + 1
      const f = fundamental * nn
      const buzz = 1 + 2.2 * Math.exp(-((nn - resCenter) * (nn - resCenter)) / (2 * resWidth * resWidth))
      const amp = (1 / nn) * buzz
      sample += amp * Math.sin(TWO_PI * f * t + phase[h])
    }
    data[i] = sample * pluckEnv
  }
  return data
}

/**
 * air-pad: an airy evolving texture. Broadband noise shaped by a few resonant
 * band-passes whose centre frequencies drift SLOWLY on independent LFOs, so a
 * small set of tonal peaks glide through the noise — breathier than a tone but
 * more tonal and moving than the noise-reed. Soft, wide, ambient.
 */
function renderAirPad(rng: () => number, sr: number, length: number): Float32Array {
  const data = new Float32Array(length)
  // Three moving resonant peaks. Centres sweep between lo/hi on slow LFOs.
  const peaks = [
    { lo: 320, hi: 520, q: 7, g: 1.0, lfoHz: 0.05, phase: rng() * TWO_PI },
    { lo: 780, hi: 1250, q: 9, g: 0.8, lfoHz: 0.07, phase: rng() * TWO_PI },
    { lo: 1900, hi: 3100, q: 10, g: 0.6, lfoHz: 0.04, phase: rng() * TWO_PI },
  ]
  // Fixed resonators driven with noise; the moving centre is emulated by blending
  // two fixed band-passes (at lo and hi) per peak so state stays stable.
  const bpLo = peaks.map((p) => makeBandpass(sr, p.lo, p.q))
  const bpHi = peaks.map((p) => makeBandpass(sr, p.hi, p.q))
  const air = makeBandpass(sr, 7000, 1.0)
  for (let k = 0; k < 256; k++) {
    const w = rng() * 2 - 1
    for (let p = 0; p < peaks.length; p++) {
      bpLo[p](w)
      bpHi[p](w)
    }
    air(w)
  }
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const white = rng() * 2 - 1
    let sample = 0
    for (let p = 0; p < peaks.length; p++) {
      // Slow crossfade between the lo and hi resonator → a peak that glides.
      const m = 0.5 - 0.5 * Math.cos(TWO_PI * peaks[p].lfoHz * t + peaks[p].phase)
      const y = bpLo[p](white) * (1 - m) + bpHi[p](white) * m
      sample += y * peaks[p].g
    }
    sample += air(white) * 0.3 // faint top air
    const breath = 0.8 + 0.2 * Math.sin(TWO_PI * 0.09 * t)
    data[i] = sample * breath
  }
  return data
}

const RENDERERS: Record<GeneratedSourceId, (rng: () => number, sr: number, length: number) => Float32Array> = {
  'harmonic-string': renderHarmonicString,
  'breath-choir': renderBreathChoir,
  'metallic-strike': renderMetallicStrike,
  'noise-reed': renderNoiseReed,
  'glass-harmonica': renderGlassHarmonica,
  'singing-bowl': renderSingingBowl,
  'brass-swell': renderBrassSwell,
  'vowel-voice': renderVowelVoice,
  'reed-organ': renderReedOrgan,
  'fm-bell': renderFmBell,
  gong: renderGong,
  'bowed-metal': renderBowedMetal,
  tanpura: renderTanpura,
  'air-pad': renderAirPad,
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
  sanitizeFinite(mono)
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
