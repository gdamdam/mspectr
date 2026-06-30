/**
 * Tempo-synced spectral pulse — a pure, deterministic modulation source.
 *
 * The host advances a beat phase (0..1, wrapping once per beat) and asks for a
 * gain multiplier. We shape a single raised-cosine "breath" per beat so the
 * pulse swells and recedes smoothly rather than clicking, and scale its depth
 * so the output is always a bounded 0..1 multiplier.
 *
 * Pure + deterministic: no Date.now / Math.random / hidden state. The same
 * (beatPhase, depth) always returns the same value, which keeps it testable and
 * lets the engine reproduce a performance from a seed.
 */

import { clamp } from '../audio/contracts'

/**
 * @param beatPhase Position within the current beat, 0..1 (wraps each beat).
 *                  Values outside [0,1] are wrapped/clamped defensively.
 * @param depth     Modulation depth, 0..1. 0 → constant 1 (no pulse); 1 → the
 *                  pulse dips all the way to 0 at the trough.
 * @returns A gain multiplier in [0,1]. At depth 0 it is always 1; for depth > 0
 *          it rises to 1 on the beat and dips to (1 - depth) between beats.
 */
export function pulseModulation(beatPhase: number, depth: number): number {
  const d = clamp(depth, 0, 1)

  // Wrap phase into [0,1). Non-finite input collapses to the start of the beat.
  let phase = Number.isFinite(beatPhase) ? beatPhase : 0
  phase = phase - Math.floor(phase)

  // Raised cosine: 1 at the downbeat (phase 0), 0 at mid-beat (phase 0.5),
  // back to 1 by the next downbeat — a smooth, click-free "breath".
  const shape = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase)

  // Mix between a flat 1 (depth 0) and the full-depth shaped pulse.
  // result = 1 - depth * (1 - shape) ∈ [1 - depth, 1] ⊆ [0, 1].
  const value = 1 - d * (1 - shape)

  // Final clamp guards against any floating-point overshoot.
  return clamp(value, 0, 1)
}
