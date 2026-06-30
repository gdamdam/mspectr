/**
 * Performance macros + XY resolution for mspectr.
 *
 * Each macro maps a single 0..1 knob onto a curated set of EXISTING
 * SpectralParams fields, so a player can sweep one control and move a whole
 * musical gesture at once. This mirrors the mgrains macro-takeover model
 * (mgrains/src/audio/macros.ts):
 *
 *   linked   => the macro WRITES (overwrites) its target params while the knob
 *               is the source of truth — the macro "takes over" those fields.
 *   unlinked => the macro is SKIPPED; the player's hand-edited baseline values
 *               in patch.params remain authoritative for those fields.
 *
 * Resolution order in resolveParams():
 *   1. start from patch.params (the hand-edited baseline)
 *   2. for each LINKED macro, overwrite MACRO_TARGETS[macro] via a curated lerp
 *   3. apply the XY surface (x/y axes → their mapped params)
 *   4. clamp + sanitize so the worklet only ever sees finite, in-range values
 *
 * The worklet itself stays dumb about macros/XY — it consumes the fully
 * resolved SpectralParams produced here on the main thread.
 */

import {
  MACRO_IDS,
  MAX_HARMONY_VOICES,
  clamp,
  sanitizeParams,
  DEFAULT_XY_MAPPING,
} from '../audio/contracts'
import type {
  MacroId,
  SpectralParams,
  SpectralPatch,
  XYMapping,
} from '../audio/contracts'

// ---------------------------------------------------------------------------
// Which params each macro touches (exposed so the UI can show link/unlink).
// ---------------------------------------------------------------------------

/**
 * NOTE on the stereoWidth conflict: both HARMONY and SPACE can influence
 * stereo width. We resolve it deterministically by processing macros in
 * MACRO_IDS order (body, motion, harmony, space) — SPACE is applied AFTER
 * HARMONY, so when both are linked SPACE wins stereoWidth. HARMONY therefore
 * contributes its width-spread feel through harmonyMix (detune/voice density)
 * rather than fighting SPACE for the width field. stereoWidth is listed under
 * both macros so the UI link/unlink display is honest about the dependency.
 */
export const MACRO_TARGETS: Record<MacroId, (keyof SpectralParams)[]> = {
  body: ['tilt', 'formant', 'gate'],
  motion: ['phaseMotion', 'blur'],
  harmony: ['harmonyVoices', 'harmonyMix', 'stereoWidth'],
  space: ['reverbAmount', 'earlyReflections', 'diffusion', 'stereoWidth'],
}

export const MACRO_LABELS: Record<MacroId, string> = {
  body: 'BODY',
  motion: 'MOTION',
  harmony: 'HARMONY',
  space: 'SPACE',
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Linear interpolation across a [lo, hi] tuple for a normalized 0..1 input. */
function lerp(lo: number, hi: number, value: number): number {
  return lo + (hi - lo) * value
}

/**
 * Apply a single macro's curated mapping onto a mutable params object,
 * OVERWRITING the targeted fields. `value` is the macro knob, expected 0..1
 * (clamped defensively). Writes the same fields listed in MACRO_TARGETS so the
 * UI link/unlink view stays in sync with what actually changes.
 */
function applyMacro(params: SpectralParams, macroId: MacroId, value: number): void {
  const v = clamp(value, 0, 1)
  switch (macroId) {
    case 'body':
      // Weight / brightness / body: tilt dark→bright, formant down→up, a touch
      // of spectral gate as the knob opens up so brighter settings stay clean.
      params.tilt = lerp(-1, 0.6, v)
      params.formant = lerp(-7, 7, v)
      params.gate = lerp(0, 0.4, v)
      break
    case 'motion':
      // Animated freeze drift + neighbouring-bin smear grow together.
      params.phaseMotion = lerp(0, 1, v)
      params.blur = lerp(0, 0.7, v)
      break
    case 'harmony':
      // More harmonized voices + wetter harmony mix. Width gets only a subtle
      // nudge here (SPACE owns the final width — see MACRO_TARGETS note).
      params.harmonyVoices = Math.round(lerp(0, MAX_HARMONY_VOICES, v))
      params.harmonyMix = lerp(0, 0.9, v)
      params.stereoWidth = lerp(0.4, 0.7, v)
      break
    case 'space':
      // Open the room: reverb tail, early reflections and diffusion bloom; the
      // image widens. SPACE is applied last so it owns stereoWidth.
      params.reverbAmount = lerp(0, 0.85, v)
      params.earlyReflections = lerp(0, 0.7, v)
      params.diffusion = lerp(0, 0.8, v)
      params.stereoWidth = lerp(0.3, 1, v)
      break
  }
}

/** Map one XY axis onto its target param, lerping [min,max] by pos (0..1). */
function applyAxis(
  params: SpectralParams,
  axis: { param: keyof SpectralParams; min: number; max: number },
  pos: number,
): void {
  const v = clamp(pos, 0, 1)
  const value = lerp(axis.min, axis.max, v)
  // harmonyVoices is the only integer-valued numeric field an axis can land on.
  // Everything else is continuous; sanitizeParams() rounds/clamps regardless,
  // but we assign as-is and let the sanitizer enforce the final shape.
  ;(params as Record<keyof SpectralParams, number | boolean | string>)[axis.param] =
    axis.param === 'harmonyVoices' ? Math.round(value) : value
}

// ---------------------------------------------------------------------------
// Public resolution
// ---------------------------------------------------------------------------

/**
 * Resolve hand-edited baseline + linked macros (takeover) + the XY surface
 * into the effective SpectralParams sent to the worklet.
 *
 * - Unlinked macros leave their target params at the hand-edited baseline.
 * - XY is applied after macros so the performance surface can ride on top of
 *   (and override) whatever macros set for the same param.
 * - The result is always finite and in range (sanitizeParams is the final
 *   boundary), so extreme macro/XY/baseline combos can never reach the DSP.
 */
export function resolveParams(
  patch: SpectralPatch,
  xyMapping: XYMapping = DEFAULT_XY_MAPPING,
): SpectralParams {
  // Start from a shallow copy of the baseline so we never mutate the patch.
  const out: SpectralParams = { ...patch.params }

  // 2. Apply each LINKED macro in MACRO_IDS order (space last → owns width).
  for (const id of MACRO_IDS) {
    if (patch.macroLinks[id]) {
      applyMacro(out, id, patch.macros[id])
    }
  }

  // 3. Apply the XY performance surface on top.
  applyAxis(out, xyMapping.x, patch.xy.x)
  applyAxis(out, xyMapping.y, patch.xy.y)

  // 4. Final clamp/sanitize — single source of truth for ranges & finiteness.
  return sanitizeParams(out)
}
