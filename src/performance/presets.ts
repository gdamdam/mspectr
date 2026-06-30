/**
 * Authored preset library for mspectr — 10 curated spectral scenes.
 *
 * Each Preset is a complete, valid object: a full SpectralPatch (which passes
 * sanitizePatch with no change of meaning), one of the four built-in
 * GeneratedSourceId sources, a coherent XY mapping, a capture strategy, and a
 * calibrationDb loudness trim. Sources are assumed ~-6 dBFS; calibration trims
 * stay modest (mostly within ±6 dB) so presets sit at comparable loudness.
 *
 * Design lineage: structure + the "small curated set, not a browser" stance is
 * adapted from mdrone (mdrone/src/engine/presets.ts) — hint/group per entry,
 * per-preset loudness trim, musically distinct scenes. mspectr's params differ
 * (spectral freeze/shift/formant/blur/harmony/space) so the values are authored
 * fresh here.
 *
 * Each entry varies freeze / phaseMotion / shift / formant / blur / tilt /
 * harmony / space / envelope / scale to stay musically distinct. Macros are
 * left LINKED or UNLINKED per preset to express whether a gesture should track
 * the macro knob or hold the hand-authored baseline (takeover model).
 */

import {
  PATCH_SCHEMA_VERSION,
  DEFAULT_PARAMS,
  type Preset,
  type SpectralParams,
  type SpectralPatch,
  type MacroValues,
  type MacroLinks,
} from '../audio/contracts'

// ---------------------------------------------------------------------------
// Small builders — keep each preset terse while staying a full, valid Patch.
// ---------------------------------------------------------------------------

/** Full SpectralParams from a partial override on top of DEFAULT_PARAMS. */
function params(overrides: Partial<SpectralParams>): SpectralParams {
  return { ...DEFAULT_PARAMS, ...overrides }
}

interface PatchInput {
  scale?: SpectralPatch['scale']
  quality?: SpectralPatch['quality']
  seed?: number
  polyphony?: number
  octave?: number
  params: SpectralParams
  macros: MacroValues
  macroLinks: MacroLinks
  xy: { x: number; y: number }
}

/** Assemble a complete SpectralPatch with sensible, in-range defaults. */
function patch(id: string, input: PatchInput): SpectralPatch {
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    presetId: id,
    quality: input.quality ?? 'normal',
    seed: input.seed ?? 0x1234,
    scale: input.scale ?? 'chromatic',
    polyphony: input.polyphony ?? 6,
    octave: input.octave ?? 0,
    params: input.params,
    macros: input.macros,
    macroLinks: input.macroLinks,
    xy: input.xy,
  }
}

// Macro link presets: all four params live in MacroLinks, so spell them out.
const LINK_ALL: MacroLinks = { body: true, motion: true, harmony: true, space: true }
const LINK_NONE: MacroLinks = { body: false, motion: false, harmony: false, space: false }
function links(o: Partial<MacroLinks>): MacroLinks {
  return { ...LINK_NONE, ...o }
}
function macros(o: Partial<MacroValues>): MacroValues {
  return { body: 0.5, motion: 0.3, harmony: 0, space: 0.3, ...o }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export const PRESETS: Preset[] = [
  // 1 — Glass Memory: frozen harmonic string, bright, slowly animated shimmer.
  {
    id: 'glass-memory',
    name: 'Glass Memory',
    hint: 'Frozen harmonic shimmer that slowly breathes — bright and still.',
    group: 'Frozen',
    source: 'harmonic-string',
    captureStrategy: 'average',
    calibrationDb: -2,
    xyMapping: { x: { param: 'shift', min: -7, max: 7 }, y: { param: 'phaseMotion', min: 0, max: 0.6 } },
    patch: patch('glass-memory', {
      scale: 'major',
      seed: 0x51a5,
      params: params({
        freeze: true,
        freezePhase: 'animate',
        tilt: 0.35,
        formant: 2,
        blur: 0.12,
        phaseMotion: 0.25,
        harmonyVoices: 2,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.4,
        attack: 0.4,
        release: 2.5,
        reverbAmount: 0.45,
        earlyReflections: 0.35,
        diffusion: 0.5,
        stereoWidth: 0.7,
      }),
      macros: macros({ body: 0.7, motion: 0.25, harmony: 0.4, space: 0.45 }),
      macroLinks: links({ space: true }),
      xy: { x: 0.5, y: 0.3 },
    }),
  },

  // 2 — Frozen Choir: held breath-choir vowel, wide, locked phase.
  {
    id: 'frozen-choir',
    name: 'Frozen Choir',
    hint: 'A held vowel suspended in air — vast, vocal, motionless.',
    group: 'Frozen',
    source: 'breath-choir',
    captureStrategy: 'average',
    calibrationDb: -3,
    xyMapping: { x: { param: 'formant', min: -5, max: 5 }, y: { param: 'reverbAmount', min: 0.2, max: 0.85 } },
    patch: patch('frozen-choir', {
      scale: 'minor',
      seed: 0xc401,
      polyphony: 4,
      params: params({
        freeze: true,
        freezePhase: 'lock',
        tilt: -0.1,
        formant: 0,
        blur: 0.25,
        phaseMotion: 0.05,
        harmonyVoices: 3,
        harmonyInterval: 'minor-triad',
        harmonyMix: 0.55,
        attack: 0.8,
        release: 3.5,
        reverbAmount: 0.7,
        earlyReflections: 0.55,
        diffusion: 0.7,
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.45, motion: 0.1, harmony: 0.6, space: 0.7 }),
      macroLinks: links({ harmony: true, space: true }),
      xy: { x: 0.5, y: 0.6 },
    }),
  },

  // 3 — Iron Bloom: metallic strike, formant-shifted up, gated and clangorous.
  {
    id: 'iron-bloom',
    name: 'Iron Bloom',
    hint: 'A struck metal mass blooming into ringing inharmonic overtones.',
    group: 'Metallic',
    source: 'metallic-strike',
    captureStrategy: 'frame',
    calibrationDb: -5,
    xyMapping: { x: { param: 'formant', min: -7, max: 7 }, y: { param: 'gate', min: 0, max: 0.5 } },
    patch: patch('iron-bloom', {
      scale: 'chromatic',
      seed: 0x190b,
      params: params({
        freeze: false,
        tilt: 0.5,
        formant: 4,
        blur: 0.05,
        gate: 0.2,
        phaseMotion: 0.15,
        harmonyVoices: 1,
        harmonyInterval: 'fifths',
        harmonyMix: 0.3,
        attack: 0.002,
        decay: 0.6,
        sustain: 0.4,
        release: 1.8,
        reverbAmount: 0.3,
        earlyReflections: 0.4,
        diffusion: 0.35,
        stereoWidth: 0.6,
      }),
      macros: macros({ body: 0.75, motion: 0.2, harmony: 0.25, space: 0.3 }),
      macroLinks: links({ body: true }),
      xy: { x: 0.5, y: 0.4 },
    }),
  },

  // 4 — Hollow Radio: noise-reed, dark + heavily blurred, lo-fi formant dip.
  {
    id: 'hollow-radio',
    name: 'Hollow Radio',
    hint: 'A distant, hollowed-out broadcast smeared into noise and haze.',
    group: 'Textural',
    source: 'noise-reed',
    captureStrategy: 'average',
    calibrationDb: 2,
    xyMapping: { x: { param: 'tilt', min: -1, max: 0.2 }, y: { param: 'blur', min: 0, max: 0.7 } },
    patch: patch('hollow-radio', {
      scale: 'dorian',
      seed: 0x4ad1,
      params: params({
        freeze: false,
        tilt: -0.6,
        formant: -4,
        blur: 0.45,
        gate: 0.1,
        phaseMotion: 0.4,
        harmonyVoices: 0,
        harmonyMix: 0.2,
        attack: 0.15,
        release: 1.2,
        reverbAmount: 0.4,
        earlyReflections: 0.5,
        diffusion: 0.55,
        stereoWidth: 0.5,
      }),
      macros: macros({ body: 0.25, motion: 0.45, harmony: 0, space: 0.4 }),
      macroLinks: links({ motion: true }),
      xy: { x: 0.4, y: 0.6 },
    }),
  },

  // 5 — Harmonic Fog: harmonic string under deep blur + diffusion, near-frozen.
  {
    id: 'harmonic-fog',
    name: 'Harmonic Fog',
    hint: 'Pitched material dissolved into a slow, diffuse spectral fog.',
    group: 'Textural',
    source: 'harmonic-string',
    captureStrategy: 'average',
    calibrationDb: -1,
    xyMapping: { x: { param: 'blur', min: 0.2, max: 0.9 }, y: { param: 'diffusion', min: 0.2, max: 0.8 } },
    patch: patch('harmonic-fog', {
      scale: 'pentatonic',
      seed: 0xf06f,
      params: params({
        freeze: true,
        freezePhase: 'animate',
        tilt: -0.2,
        formant: 0,
        blur: 0.55,
        phaseMotion: 0.5,
        harmonyVoices: 2,
        harmonyInterval: 'fourths-fifths',
        harmonyMix: 0.45,
        attack: 1.2,
        release: 4,
        reverbAmount: 0.6,
        earlyReflections: 0.45,
        diffusion: 0.65,
        stereoWidth: 0.8,
      }),
      macros: macros({ body: 0.4, motion: 0.5, harmony: 0.4, space: 0.6 }),
      macroLinks: LINK_ALL,
      xy: { x: 0.45, y: 0.5 },
    }),
  },

  // 6 — Breath Organ: breath-choir as a sustaining organ, fifths, mid space.
  {
    id: 'breath-organ',
    name: 'Breath Organ',
    hint: 'A breathing pipe-organ pad stacked in open fifths.',
    group: 'Organ',
    source: 'breath-choir',
    captureStrategy: 'average',
    calibrationDb: -4,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'harmonyMix', min: 0, max: 0.9 } },
    patch: patch('breath-organ', {
      scale: 'mixolydian',
      seed: 0xb103,
      params: params({
        freeze: false,
        tilt: 0.05,
        formant: 1,
        blur: 0.1,
        phaseMotion: 0.2,
        harmonyVoices: 3,
        harmonyInterval: 'fifths',
        harmonyMix: 0.6,
        attack: 0.3,
        sustain: 0.9,
        release: 1.5,
        reverbAmount: 0.35,
        earlyReflections: 0.4,
        diffusion: 0.4,
        stereoWidth: 0.65,
      }),
      macros: macros({ body: 0.55, motion: 0.2, harmony: 0.65, space: 0.4 }),
      macroLinks: links({ harmony: true }),
      xy: { x: 0.5, y: 0.6 },
    }),
  },

  // 7 — Spectral Bells: metallic strike, shimmer harmony, bright + sparse.
  {
    id: 'spectral-bells',
    name: 'Spectral Bells',
    hint: 'Bright struck bells ringing up into shimmering octave harmonics.',
    group: 'Metallic',
    source: 'metallic-strike',
    captureStrategy: 'frame',
    calibrationDb: -4,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'phaseMotion', min: 0, max: 0.8 } },
    patch: patch('spectral-bells', {
      scale: 'major',
      seed: 0xbe11,
      params: params({
        freeze: false,
        tilt: 0.55,
        formant: 5,
        blur: 0.02,
        gate: 0.15,
        phaseMotion: 0.35,
        harmonyVoices: 3,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.5,
        attack: 0.001,
        decay: 0.8,
        sustain: 0.3,
        release: 2.2,
        reverbAmount: 0.5,
        earlyReflections: 0.55,
        diffusion: 0.45,
        stereoWidth: 0.85,
      }),
      macros: macros({ body: 0.8, motion: 0.35, harmony: 0.55, space: 0.5 }),
      macroLinks: links({ harmony: true, space: true }),
      xy: { x: 0.5, y: 0.35 },
    }),
  },

  // 8 — Slow Machine: noise-reed cluster, mechanical motion, mid-dark.
  {
    id: 'slow-machine',
    name: 'Slow Machine',
    hint: 'A grinding mechanical drone of clustered partials in slow motion.',
    group: 'Textural',
    source: 'noise-reed',
    captureStrategy: 'frame',
    calibrationDb: 0,
    xyMapping: { x: { param: 'blur', min: 0, max: 0.7 }, y: { param: 'phaseMotion', min: 0, max: 1 } },
    patch: patch('slow-machine', {
      scale: 'minor',
      seed: 0x510c,
      params: params({
        freeze: false,
        tilt: -0.3,
        formant: -2,
        blur: 0.3,
        gate: 0.25,
        phaseMotion: 0.6,
        harmonyVoices: 2,
        harmonyInterval: 'cluster',
        harmonyMix: 0.5,
        attack: 0.05,
        release: 0.8,
        reverbAmount: 0.25,
        earlyReflections: 0.3,
        diffusion: 0.5,
        stereoWidth: 0.55,
      }),
      macros: macros({ body: 0.4, motion: 0.6, harmony: 0.5, space: 0.3 }),
      macroLinks: links({ motion: true, harmony: true }),
      xy: { x: 0.4, y: 0.6 },
    }),
  },

  // 9 — Formant Tide: harmonic string with a swept formant, gentle motion.
  {
    id: 'formant-tide',
    name: 'Formant Tide',
    hint: 'A vowel-like formant tide rolling over a sustained string.',
    group: 'Organ',
    source: 'harmonic-string',
    captureStrategy: 'average',
    calibrationDb: -2,
    xyMapping: { x: { param: 'formant', min: -7, max: 7 }, y: { param: 'tilt', min: -1, max: 0.6 } },
    patch: patch('formant-tide', {
      scale: 'dorian',
      seed: 0xf17d,
      params: params({
        freeze: false,
        tilt: 0.1,
        formant: -3,
        blur: 0.15,
        phaseMotion: 0.3,
        harmonyVoices: 1,
        harmonyInterval: 'octaves',
        harmonyMix: 0.35,
        attack: 0.25,
        sustain: 0.85,
        release: 1.6,
        reverbAmount: 0.4,
        earlyReflections: 0.4,
        diffusion: 0.45,
        stereoWidth: 0.7,
      }),
      macros: macros({ body: 0.5, motion: 0.3, harmony: 0.3, space: 0.4 }),
      macroLinks: links({ body: true }),
      xy: { x: 0.3, y: 0.55 },
    }),
  },

  // 10 — Noise Cathedral: breath-choir + noise wash, maximal space, dark.
  {
    id: 'noise-cathedral',
    name: 'Noise Cathedral',
    hint: 'An immense, dark reverberant nave of breath and noise.',
    group: 'Frozen',
    source: 'breath-choir',
    captureStrategy: 'average',
    calibrationDb: -6,
    xyMapping: { x: { param: 'reverbAmount', min: 0.3, max: 0.85 }, y: { param: 'diffusion', min: 0.2, max: 0.8 } },
    patch: patch('noise-cathedral', {
      scale: 'minor',
      seed: 0xca7e,
      polyphony: 4,
      params: params({
        freeze: true,
        freezePhase: 'animate',
        tilt: -0.45,
        formant: -2,
        blur: 0.4,
        phaseMotion: 0.45,
        harmonyVoices: 4,
        harmonyInterval: 'fourths-fifths',
        harmonyMix: 0.6,
        attack: 1.5,
        release: 6,
        reverbAmount: 0.85,
        earlyReflections: 0.65,
        diffusion: 0.8,
        stereoWidth: 1,
      }),
      macros: macros({ body: 0.3, motion: 0.45, harmony: 0.7, space: 0.9 }),
      macroLinks: LINK_ALL,
      xy: { x: 0.7, y: 0.6 },
    }),
  },
]

/** Look up a preset by id. Returns undefined when no preset matches. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
