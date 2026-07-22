/**
 * Authored preset library for mspectr — a curated set of spectral scenes.
 *
 * Each Preset is a complete, valid object: a full SpectralPatch (which passes
 * sanitizePatch with no change of meaning), one of the built-in GeneratedSourceId
 * sources, a coherent XY mapping, a capture strategy, and a calibrationDb loudness
 * trim. Sources are assumed ~-6 dBFS; calibration trims stay modest (mostly within
 * ±6 dB) so presets sit at comparable loudness.
 *
 * Source coverage: the library spans ALL 14 generated sources so each preset's
 * character is carried by the generator best suited to it (a glassy preset on the
 * glass-harmonica, an organ on the reed-organ, a bowl clang on the singing-bowl,
 * …) rather than colouring four generators with spectral processing alone. A
 * source-coverage test in presets.test.ts guards this.
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
  // 1 — Glass Memory: frozen glass-harmonica, VERY bright (max tilt), locked
  //     phase, octave up. The pure high glassy sines are the natural home for a
  //     "glass" preset. Facet: bright + high formant + phase-lock stillness.
  {
    id: 'glass-memory',
    name: 'Glass Memory',
    hint: 'Frozen glass shimmer held perfectly still — pure, glassy and bright.',
    group: 'Frozen',
    source: 'glass-harmonica',
    captureStrategy: 'average',
    // Pure sines carry less energy than a full harmonic series at equal peak —
    // trim toward unity so it sits with the denser presets.
    calibrationDb: 0,
    xyMapping: { x: { param: 'shift', min: -7, max: 7 }, y: { param: 'phaseMotion', min: 0, max: 0.6 } },
    patch: patch('glass-memory', {
      scale: 'major',
      seed: 0x51a5,
      octave: 1,
      params: params({
        freeze: true,
        freezePhase: 'lock', // locked = still, glassy
        tilt: 0.9, // very bright
        formant: 7, // push formants up for glass
        blur: 0.05,
        phaseMotion: 0.05,
        harmonyVoices: 2,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.4,
        attack: 0.4,
        release: 2.5,
        reverbAmount: 0.4,
        earlyReflections: 0.35,
        diffusion: 0.4,
        stereoWidth: 0.7,
      }),
      macros: macros({ body: 0.7, motion: 0.05, harmony: 0.4, space: 0.4 }),
      macroLinks: links({ space: true }),
      xy: { x: 0.5, y: 0.1 },
    }),
  },

  // 2 — Frozen Choir: held breath-choir vowel, neutral tilt, wide, locked phase.
  //     Facet: airy top-band source + phase-lock + minor-triad harmony, vast width.
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
        tilt: 0.3, // bright, sits high in the air-band (contrasts the dark Breath Organ)
        formant: 0,
        blur: 0.15,
        phaseMotion: 0.05,
        harmonyVoices: 3,
        harmonyInterval: 'minor-triad',
        harmonyMix: 0.55,
        attack: 0.8,
        release: 3.5,
        reverbAmount: 0.7,
        earlyReflections: 0.55,
        diffusion: 0.7,
        stereoWidth: 0.95,
      }),
      macros: macros({ body: 0.45, motion: 0.1, harmony: 0.6, space: 0.7 }),
      macroLinks: links({ harmony: true, space: true }),
      xy: { x: 0.5, y: 0.6 },
    }),
  },

  // 3 — Iron Bloom: gong (tam-tam wash), bright, gated + animated, plucked
  //     envelope. A struck metal MASS that blooms → the dense broadband gong is
  //     the literal source; the gate sparsens its wash into ringing partials.
  //     Facet: inharmonic wash + gate + fast attack + fifths, dry-ish.
  {
    id: 'iron-bloom',
    name: 'Iron Bloom',
    hint: 'A struck metal mass blooming into ringing inharmonic overtones.',
    group: 'Metallic',
    source: 'gong',
    captureStrategy: 'frame',
    // The gong is the densest generator — trim hardest of the metallic set.
    calibrationDb: -6,
    xyMapping: { x: { param: 'formant', min: -7, max: 7 }, y: { param: 'gate', min: 0, max: 0.5 } },
    patch: patch('iron-bloom', {
      scale: 'chromatic',
      seed: 0x190b,
      octave: -1,
      params: params({
        freeze: false,
        tilt: 0.35, // bright, but the source is already high
        formant: 0,
        blur: 0.0, // razor sharp bell partials
        gate: 0.3, // strong spectral gate → sparse, clangorous
        phaseMotion: 0.2,
        harmonyVoices: 1,
        harmonyInterval: 'fifths',
        harmonyMix: 0.3,
        attack: 0.002,
        decay: 0.6,
        sustain: 0.4,
        release: 1.8,
        reverbAmount: 0.25,
        earlyReflections: 0.4,
        diffusion: 0.3,
        stereoWidth: 0.6,
      }),
      macros: macros({ body: 0.75, motion: 0.2, harmony: 0.25, space: 0.25 }),
      macroLinks: links({ body: true }),
      xy: { x: 0.5, y: 0.5 },
    }),
  },

  // 4 — Hollow Radio: noise-reed, DARK (negative tilt) + formant dip, gritty.
  //     Facet: buzzy source darkened by tilt + downward formant → lo-fi, no blur.
  {
    id: 'hollow-radio',
    name: 'Hollow Radio',
    hint: 'A distant, hollowed-out broadcast — gritty, dark, mono-ish.',
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
        tilt: -0.7, // dark — this is the deliberately dark reed
        formant: -6, // formants pulled down for the "hollow" telephone dip
        blur: 0.1, // light — grit preserved, not smeared
        gate: 0.15,
        phaseMotion: 0.35,
        harmonyVoices: 0,
        harmonyMix: 0.2,
        attack: 0.15,
        release: 1.2,
        reverbAmount: 0.3,
        earlyReflections: 0.35,
        diffusion: 0.35,
        stereoWidth: 0.35, // narrow, mono-ish radio
      }),
      macros: macros({ body: 0.25, motion: 0.35, harmony: 0, space: 0.3 }),
      macroLinks: links({ motion: true }),
      xy: { x: 0.25, y: 0.15 },
    }),
  },

  // 5 — Harmonic Fog: air-pad under DEEP blur + diffusion, near-frozen. The
  //     air-pad's drifting resonant peaks are already a diffuse, breathy texture;
  //     heavy blur dissolves its tonal peaks into fog.
  //     Facet: the one deliberate high-blur "fog" preset — smear + animate.
  {
    id: 'harmonic-fog',
    name: 'Harmonic Fog',
    hint: 'Pitched material dissolved into a slow, diffuse spectral fog.',
    group: 'Textural',
    source: 'air-pad',
    captureStrategy: 'average',
    calibrationDb: -2,
    xyMapping: { x: { param: 'blur', min: 0.2, max: 0.9 }, y: { param: 'diffusion', min: 0.2, max: 0.8 } },
    patch: patch('harmonic-fog', {
      scale: 'pentatonic',
      seed: 0xf06f,
      params: params({
        freeze: true,
        freezePhase: 'animate',
        tilt: 0.25, // slightly bright so fog doesn't drop into the dark cluster
        formant: 3,
        blur: 0.65, // THE fog preset — heavy smear (reserved high blur)
        phaseMotion: 0.55,
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

  // 6 — Breath Organ: reed-organ (harmonium) as a sustaining organ, shift-stacked
  //     fifths. The reed-organ IS a pump-organ, so the pipe-organ character comes
  //     from the source rather than being faked on an airy pad.
  //     Facet: harmonium pitched DOWN (shift) into open fifths, sustained organ.
  {
    id: 'breath-organ',
    name: 'Breath Organ',
    hint: 'A breathing pipe-organ pad stacked in open fifths.',
    group: 'Organ',
    source: 'reed-organ',
    captureStrategy: 'average',
    calibrationDb: -4,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'harmonyMix', min: 0, max: 0.9 } },
    patch: patch('breath-organ', {
      scale: 'mixolydian',
      seed: 0xb103,
      octave: -1,
      params: params({
        freeze: false,
        tilt: -0.55, // warm, dark organ body
        shift: -12, // relocate the whole spectrum an octave down for a big pedal register
        formant: -5, // pull the reed formants down into an organ register
        blur: 0.2,
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

  // 7 — Spectral Bells: fm-bell, MAX bright + shimmer harmony, sparse. The FM
  //     bell's clangorous inharmonic sidebands are the archetypal "bell" tone.
  //     Facet: FM bell + shimmer octave stack + high tilt, wide + spacious.
  {
    id: 'spectral-bells',
    name: 'Spectral Bells',
    hint: 'Bright struck bells ringing up into shimmering octave harmonics.',
    group: 'Metallic',
    source: 'fm-bell',
    captureStrategy: 'frame',
    // A single FM carrier/modulator pair is thinner than the struck-bar strike —
    // less negative trim so the bells stay present.
    calibrationDb: -2,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'phaseMotion', min: 0, max: 0.8 } },
    patch: patch('spectral-bells', {
      scale: 'major',
      seed: 0xbe11,
      octave: 1,
      params: params({
        freeze: false,
        tilt: 0.7,
        formant: 4,
        blur: 0.02,
        gate: 0.1,
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
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.8, motion: 0.35, harmony: 0.55, space: 0.5 }),
      macroLinks: links({ harmony: true, space: true }),
      xy: { x: 0.5, y: 0.35 },
    }),
  },

  // 8 — Slow Machine: noise-reed cluster, NEUTRAL tilt, heavy phase motion.
  //     Facet: buzzy source + cluster harmony + strong phaseMotion (grinding), dry.
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
        tilt: 0.15, // slightly bright — keeps the reed grit up, away from Hollow Radio's dark
        formant: 2,
        blur: 0.15,
        gate: 0.3,
        phaseMotion: 0.8, // heavy grind
        harmonyVoices: 2,
        harmonyInterval: 'cluster',
        harmonyMix: 0.5,
        attack: 0.05,
        release: 0.8,
        reverbAmount: 0.2,
        earlyReflections: 0.3,
        diffusion: 0.5,
        stereoWidth: 0.5,
      }),
      macros: macros({ body: 0.4, motion: 0.8, harmony: 0.5, space: 0.25 }),
      macroLinks: links({ motion: true, harmony: true }),
      xy: { x: 0.3, y: 0.7 },
    }),
  },

  // 9 — Formant Tide: brass-swell, warm mid-dark, swept formant, octaves. The
  //     brass-swell already sweeps a bright formant up its harmonic series over
  //     the loop — the "tide" rides that moving formant.
  //     Facet: brass darkened + downward formant sweep + octave doubling, mellow.
  {
    id: 'formant-tide',
    name: 'Formant Tide',
    hint: 'A vowel-like formant tide rolling over a sustained brass swell.',
    group: 'Organ',
    source: 'brass-swell',
    captureStrategy: 'average',
    calibrationDb: -3,
    xyMapping: { x: { param: 'formant', min: -7, max: 7 }, y: { param: 'tilt', min: -1, max: 0.6 } },
    patch: patch('formant-tide', {
      scale: 'dorian',
      seed: 0xf17d,
      octave: -1,
      params: params({
        freeze: false,
        tilt: -0.4, // warm/dark brass body
        shift: -7, // drop spectral energy a fifth for a deeper swell
        formant: -4, // formants swept down for the vowel "tide"
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
      xy: { x: 0.35, y: 0.25 },
    }),
  },

  // 10 — Noise Cathedral: breath-choir + noise wash, maximal space, mid blur.
  //      Facet: airy source + 4-voice fourths/fifths + huge reverb, animated.
  {
    id: 'noise-cathedral',
    name: 'Noise Cathedral',
    hint: 'An immense reverberant nave of buzzing reed-noise.',
    group: 'Frozen',
    source: 'noise-reed',
    captureStrategy: 'average',
    calibrationDb: -6,
    xyMapping: { x: { param: 'reverbAmount', min: 0.3, max: 0.85 }, y: { param: 'diffusion', min: 0.2, max: 0.8 } },
    patch: patch('noise-cathedral', {
      scale: 'minor',
      seed: 0xca7e,
      polyphony: 4,
      octave: 1,
      params: params({
        freeze: true,
        freezePhase: 'animate',
        tilt: 0.6, // very bright airy wash — sits high, clear of the dark noise-reed presets
        formant: 7,
        blur: 0.2, // keep spectral detail so it stays bright rather than smearing dark
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
      macros: macros({ body: 0.85, motion: 0.3, harmony: 0.7, space: 0.9 }),
      macroLinks: LINK_ALL,
      xy: { x: 0.7, y: 0.6 },
    }),
  },

  // ---- Demo presets — each spotlights a capability of the instrument. -------

  // 11 — Living Pluck: LIVING capture + phase-lock. Hear a string's attack and
  //      decay captured alive, played clean. XY sweeps the inharmonic SHIFT.
  {
    id: 'living-pluck',
    name: 'Living Pluck',
    hint: 'Capture (Living) a string: its pluck and decay play back alive. Sweep X to bend it inharmonic.',
    group: 'Living',
    source: 'harmonic-string',
    captureStrategy: 'evolving',
    calibrationDb: -2,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'blur', min: 0, max: 0.5 } },
    patch: patch('living-pluck', {
      scale: 'major',
      seed: 0x11a1,
      params: params({
        freeze: false,
        freezePhase: 'lock',
        tilt: 0.4,
        blur: 0.05,
        phaseMotion: 0,
        attack: 0.004,
        decay: 0.5,
        sustain: 0.35,
        release: 0.7,
        reverbAmount: 0.15,
        earlyReflections: 0.2,
        stereoWidth: 0.4,
      }),
      macros: macros({ body: 0.7, motion: 0.05, harmony: 0, space: 0.2 }),
      macroLinks: links({}),
      xy: { x: 0.5, y: 0.1 },
    }),
  },

  // 12 — Harmonic Cloud: HARMONIZE + spectral MOTION on the tanpura. Its
  //      jvari-buzzing sympathetic-string drone is already a shimmering, slowly
  //      evolving harmonic cloud — harmony + animated phase amplify that drift.
  {
    id: 'harmonic-cloud',
    name: 'Harmonic Cloud',
    hint: 'A shimmering harmonized cloud that drifts and breathes. Ride MOTION and HARMONY.',
    group: 'Living',
    source: 'tanpura',
    captureStrategy: 'evolving',
    calibrationDb: -4,
    xyMapping: { x: { param: 'harmonyMix', min: 0, max: 0.9 }, y: { param: 'phaseMotion', min: 0.1, max: 1 } },
    patch: patch('harmonic-cloud', {
      scale: 'pentatonic',
      seed: 0x11c2,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        tilt: 0.1,
        blur: 0.35,
        phaseMotion: 0.7,
        harmonyVoices: 4,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.7,
        attack: 0.6,
        release: 3,
        reverbAmount: 0.6,
        earlyReflections: 0.5,
        diffusion: 0.6,
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.5, motion: 0.7, harmony: 0.8, space: 0.6 }),
      macroLinks: links({ motion: true, harmony: true }),
      xy: { x: 0.6, y: 0.6 },
    }),
  },

  // 13 — Tidal Breath: spectral MOTION as the star. Breath that swells and
  //      recedes — the whole spectrum in slow motion (MOTION macro linked high).
  {
    id: 'tidal-breath',
    name: 'Tidal Breath',
    hint: 'Breath that swells and recedes — the spectrum itself in motion. Push MOTION.',
    group: 'Living',
    source: 'breath-choir',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'formant', min: -6, max: 6 }, y: { param: 'blur', min: 0.1, max: 0.7 } },
    patch: patch('tidal-breath', {
      scale: 'dorian',
      seed: 0x11d3,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        tilt: 0,
        blur: 0.4,
        phaseMotion: 0.85,
        attack: 1,
        release: 4,
        reverbAmount: 0.7,
        earlyReflections: 0.55,
        diffusion: 0.7,
        stereoWidth: 0.95,
      }),
      macros: macros({ body: 0.45, motion: 0.85, harmony: 0.2, space: 0.7 }),
      macroLinks: links({ motion: true, space: true }),
      xy: { x: 0.5, y: 0.5 },
    }),
  },

  // 14 — Iron Harmony: HARMONIZE on struck metal. Bells ringing in stacked
  //      fifths, phase-locked so the partials stay clear.
  {
    id: 'iron-harmony',
    name: 'Iron Harmony',
    hint: 'Struck metal ringing in stacked fifths, phase-locked and clear.',
    group: 'Metallic',
    source: 'metallic-strike',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'harmonyMix', min: 0, max: 0.9 } },
    patch: patch('iron-harmony', {
      scale: 'minor',
      seed: 0x11e4,
      params: params({
        freeze: false,
        freezePhase: 'lock',
        tilt: 0.3,
        formant: 3,
        blur: 0.03,
        phaseMotion: 0.1,
        harmonyVoices: 3,
        harmonyInterval: 'fifths',
        harmonyMix: 0.6,
        attack: 0.01,
        decay: 1.2,
        sustain: 0.5,
        release: 2,
        reverbAmount: 0.4,
        stereoWidth: 0.6,
      }),
      macros: macros({ body: 0.6, motion: 0.1, harmony: 0.6, space: 0.4 }),
      macroLinks: links({ harmony: true }),
      xy: { x: 0.5, y: 0.55 },
    }),
  },

  // 15 — Morph Study: A/B MORPH. Capture A and B, then sweep X to glide between
  //      two spectra through their interpolated envelope.
  {
    id: 'morph-study',
    name: 'Morph Study',
    hint: 'Capture into A and B, then sweep X to morph between the two spectra.',
    group: 'Living',
    source: 'harmonic-string',
    captureStrategy: 'evolving',
    calibrationDb: -2,
    xyMapping: { x: { param: 'morph', min: 0, max: 1 }, y: { param: 'tilt', min: -0.6, max: 0.6 } },
    patch: patch('morph-study', {
      scale: 'mixolydian',
      seed: 0x11f5,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        morph: 0.5,
        tilt: 0.2,
        blur: 0.1,
        phaseMotion: 0.2,
        attack: 0.2,
        release: 1.5,
        reverbAmount: 0.3,
        stereoWidth: 0.6,
      }),
      macros: macros({ body: 0.55, motion: 0.25, harmony: 0.1, space: 0.35 }),
      macroLinks: links({}),
      xy: { x: 0.5, y: 0.6 },
    }),
  },

  // 16 — Spectral Shift: LIVING capture whose XClick bends the whole spectrum
  //      inharmonic (x→shift). Bright major-triad stack, animated so the shifted
  //      partials keep breathing. Showcases the SHIFT gesture end-to-end.
  {
    id: 'spectral-shift',
    name: 'Spectral Shift',
    hint: 'Capture Living, then sweep X to slide the whole spectrum off its harmonics.',
    group: 'Living',
    source: 'harmonic-string',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'shift', min: -12, max: 12 }, y: { param: 'formant', min: -7, max: 7 } },
    patch: patch('spectral-shift', {
      scale: 'major',
      seed: 0x5417,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        shift: 5, // baseline already nudged off-harmonic
        tilt: 0.5,
        formant: 2,
        blur: 0.08,
        phaseMotion: 0.3,
        harmonyVoices: 3,
        harmonyInterval: 'major-triad',
        harmonyMix: 0.45,
        attack: 0.05,
        decay: 0.6,
        sustain: 0.5,
        release: 1.4,
        reverbAmount: 0.35,
        earlyReflections: 0.4,
        diffusion: 0.45,
        stereoWidth: 0.7,
      }),
      macros: macros({ body: 0.6, motion: 0.3, harmony: 0.45, space: 0.35 }),
      macroLinks: links({ harmony: true }),
      xy: { x: 0.7, y: 0.5 },
    }),
  },

  // 17 — Glass Gate: metallic strike under a HARD spectral GATE — only the loudest
  //      partials survive, so it stutters into sparse glassy pings. XY rides the
  //      gate threshold. Showcases the spectral GATE at high values.
  {
    id: 'glass-gate',
    name: 'Glass Gate',
    hint: 'A hard spectral gate carves struck metal into sparse glassy pings — ride Y to open it.',
    group: 'Metallic',
    source: 'metallic-strike',
    captureStrategy: 'evolving',
    calibrationDb: -4,
    xyMapping: { x: { param: 'formant', min: -7, max: 7 }, y: { param: 'gate', min: 0.1, max: 0.8 } },
    patch: patch('glass-gate', {
      scale: 'chromatic',
      seed: 0x61a7,
      octave: 1,
      params: params({
        freeze: false,
        freezePhase: 'lock',
        tilt: 0.55,
        formant: 5,
        blur: 0.0,
        gate: 0.55, // strong gate — reserved high end of the gate range
        phaseMotion: 0.15,
        harmonyVoices: 2,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.35,
        attack: 0.001,
        decay: 0.4,
        sustain: 0.25,
        release: 1.5,
        reverbAmount: 0.45,
        earlyReflections: 0.5,
        diffusion: 0.35,
        stereoWidth: 0.85,
      }),
      macros: macros({ body: 0.7, motion: 0.15, harmony: 0.35, space: 0.45 }),
      macroLinks: links({ space: true }),
      xy: { x: 0.5, y: 0.5 },
    }),
  },

  // 18 — Formant Choir: LIVING vowel-voice with the XY sweeping FORMANT across
  //      its full range — vowels morph a↔i↔u under the hand. The vowel-voice is
  //      the true formant source (a glottal pulse through vocal formants), so the
  //      FORMANT sweep acts on real vowel resonances. Bright, shimmering, wide.
  {
    id: 'formant-choir',
    name: 'Formant Choir',
    hint: 'A living voice whose vowel morphs under your hand — sweep X to slide the formant a↔i↔u.',
    group: 'Living',
    source: 'vowel-voice',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'formant', min: -12, max: 12 }, y: { param: 'harmonyMix', min: 0, max: 0.85 } },
    patch: patch('formant-choir', {
      scale: 'major',
      seed: 0xf0c8,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        tilt: 0.45,
        formant: 1,
        blur: 0.18,
        phaseMotion: 0.4,
        harmonyVoices: 3,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.5,
        attack: 0.7,
        release: 3,
        reverbAmount: 0.55,
        earlyReflections: 0.5,
        diffusion: 0.6,
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.5, motion: 0.4, harmony: 0.6, space: 0.55 }),
      macroLinks: links({ motion: true, harmony: true }),
      xy: { x: 0.5, y: 0.55 },
    }),
  },

  // 19 — Cluster Reed: LIVING noise-reed ground into a dense CLUSTER stack under
  //      heavy phase MOTION — a churning dissonant swarm. Showcases cluster
  //      harmony plus strong MOTION on the noisiest source.
  {
    id: 'cluster-reed',
    name: 'Cluster Reed',
    hint: 'A living reed ground into a churning cluster swarm — push MOTION to set the partials boiling.',
    group: 'Textural',
    source: 'noise-reed',
    captureStrategy: 'evolving',
    calibrationDb: -1,
    xyMapping: { x: { param: 'blur', min: 0, max: 0.8 }, y: { param: 'phaseMotion', min: 0.2, max: 1 } },
    patch: patch('cluster-reed', {
      scale: 'dorian',
      seed: 0xc1ee,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        tilt: -0.15,
        formant: -2,
        blur: 0.25,
        gate: 0.2,
        phaseMotion: 0.9, // boiling churn
        harmonyVoices: 3,
        harmonyInterval: 'cluster',
        harmonyMix: 0.55,
        attack: 0.1,
        release: 1,
        reverbAmount: 0.3,
        earlyReflections: 0.35,
        diffusion: 0.55,
        stereoWidth: 0.6,
      }),
      macros: macros({ body: 0.4, motion: 0.9, harmony: 0.55, space: 0.3 }),
      macroLinks: links({ motion: true, harmony: true }),
      xy: { x: 0.3, y: 0.8 },
    }),
  },

  // 20 — Morph Veil: A/B MORPH on the vowel-voice. Capture two vowels, then
  //      sweep X to glide between them through a diffuse veil. Distinct from
  //      Morph Study (different source, harmony, scale, motion).
  {
    id: 'morph-veil',
    name: 'Morph Veil',
    hint: 'Capture two vowels into A and B, then sweep X to morph across a diffuse veil.',
    group: 'Living',
    source: 'vowel-voice',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'morph', min: 0, max: 1 }, y: { param: 'blur', min: 0.1, max: 0.7 } },
    patch: patch('morph-veil', {
      scale: 'minor',
      seed: 0x707e,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        morph: 0.5,
        tilt: -0.1,
        formant: -1,
        blur: 0.3,
        phaseMotion: 0.45,
        harmonyVoices: 2,
        harmonyInterval: 'major-triad',
        harmonyMix: 0.4,
        attack: 0.9,
        release: 3.5,
        reverbAmount: 0.65,
        earlyReflections: 0.5,
        diffusion: 0.65,
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.45, motion: 0.45, harmony: 0.4, space: 0.65 }),
      macroLinks: links({ space: true }),
      xy: { x: 0.5, y: 0.5 },
    }),
  },

  // 21 — Black Ember: the DARK extreme. Singing-bowl crushed to the bottom
  //      (tilt -0.9) with formants pulled down and a spectral gate — a smouldering,
  //      subterranean clang. The low, inharmonic, beating metal bowl is already
  //      dark and metallic; the tilt drives it subterranean. Anchors the dark end.
  {
    id: 'black-ember',
    name: 'Black Ember',
    hint: 'A struck metal bowl crushed to its darkest ember — a smouldering, subterranean clang.',
    group: 'Metallic',
    source: 'singing-bowl',
    captureStrategy: 'average',
    // Already low and darkened hard — nudge up so it isn't swallowed by the mix.
    calibrationDb: 1,
    xyMapping: { x: { param: 'tilt', min: -1, max: 0 }, y: { param: 'gate', min: 0, max: 0.6 } },
    patch: patch('black-ember', {
      scale: 'minor',
      seed: 0xb1ac,
      octave: -1,
      params: params({
        freeze: false,
        freezePhase: 'lock',
        tilt: -0.9, // darkest preset in the library
        formant: -7,
        blur: 0.05,
        gate: 0.25,
        phaseMotion: 0.15,
        harmonyVoices: 1,
        harmonyInterval: 'fifths',
        harmonyMix: 0.3,
        attack: 0.003,
        decay: 1,
        sustain: 0.4,
        release: 2.5,
        reverbAmount: 0.3,
        earlyReflections: 0.35,
        diffusion: 0.4,
        stereoWidth: 0.55,
      }),
      macros: macros({ body: 0.7, motion: 0.15, harmony: 0.3, space: 0.3 }),
      macroLinks: links({ body: true }),
      xy: { x: 0.3, y: 0.4 },
    }),
  },

  // 22 — Shimmer Rise: LIVING bowed-metal with an animated SHIMMER stack that
  //      climbs in bright octave/twelfth overtones. The bowed-metal plate already
  //      raises its upper overtones over the loop (a climbing centroid), so the
  //      "rise" is built into the source; XY slides the whole thing in inharmonic
  //      shift. Eerie, ascending, wide.
  {
    id: 'shimmer-rise',
    name: 'Shimmer Rise',
    hint: 'A bowed metal plate climbing into bright shimmering overtones — sweep X to lift it inharmonic.',
    group: 'Living',
    source: 'bowed-metal',
    captureStrategy: 'evolving',
    calibrationDb: -3,
    xyMapping: { x: { param: 'shift', min: 0, max: 12 }, y: { param: 'reverbAmount', min: 0.2, max: 0.8 } },
    patch: patch('shimmer-rise', {
      scale: 'mixolydian',
      seed: 0x51e2,
      octave: 1,
      params: params({
        freeze: false,
        freezePhase: 'animate',
        shift: 3,
        tilt: 0.65,
        formant: 6,
        blur: 0.12,
        phaseMotion: 0.5,
        harmonyVoices: 4,
        harmonyInterval: 'shimmer',
        harmonyMix: 0.6,
        attack: 0.3,
        release: 2.8,
        reverbAmount: 0.55,
        earlyReflections: 0.55,
        diffusion: 0.5,
        stereoWidth: 0.95,
      }),
      macros: macros({ body: 0.6, motion: 0.5, harmony: 0.6, space: 0.55 }),
      macroLinks: links({ motion: true, harmony: true, space: true }),
      xy: { x: 0.25, y: 0.5 },
    }),
  },

  // 23 — Locked Prism: phase-LOCK stillness as the star. A frozen harmonic string
  //      held dead-still, split into a bright minor-triad prism, then thrown into
  //      a huge space. Contrast to the animated shimmer presets.
  {
    id: 'locked-prism',
    name: 'Locked Prism',
    hint: 'A phase-locked string held dead-still and split into a bright minor-triad prism.',
    group: 'Frozen',
    source: 'harmonic-string',
    captureStrategy: 'average',
    calibrationDb: -3,
    xyMapping: { x: { param: 'harmonyMix', min: 0, max: 0.9 }, y: { param: 'reverbAmount', min: 0.2, max: 0.85 } },
    patch: patch('locked-prism', {
      scale: 'pentatonic',
      seed: 0x10c9,
      params: params({
        freeze: true,
        freezePhase: 'lock', // dead-still, phase-locked
        tilt: 0.75,
        formant: 5,
        blur: 0.08,
        phaseMotion: 0.02, // near-zero — distinct from every animated preset
        harmonyVoices: 3,
        harmonyInterval: 'minor-triad',
        harmonyMix: 0.55,
        attack: 0.6,
        release: 4,
        reverbAmount: 0.65,
        earlyReflections: 0.6,
        diffusion: 0.6,
        stereoWidth: 0.9,
      }),
      macros: macros({ body: 0.65, motion: 0.02, harmony: 0.55, space: 0.65 }),
      macroLinks: links({ harmony: true, space: true }),
      xy: { x: 0.5, y: 0.5 },
    }),
  },
]

/** Look up a preset by id. Returns undefined when no preset matches. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
