/**
 * Last-session autosave — mirrors the mdrone/mchord "continue" behavior at the
 * patch level. The full performance patch (params, macros, XY, quality, scale,
 * seed, polyphony) is stored in localStorage so a reload can offer to pick up
 * where the player left off. Captured snapshots are heavier and consent-gated,
 * so they live in named IndexedDB sessions rather than this lightweight autosave.
 *
 * Everything is defensive: storage failures (private mode, quota) are swallowed,
 * and any restored value is run through sanitizePatch before it can reach the UI
 * or the DSP loop.
 */
import { sanitizePatch, type SpectralPatch } from '../audio/contracts'

export const LAST_PATCH_KEY = 'mspectr.lastPatch'

/** Persist the current patch as the "last session". Never throws. */
export function saveLastPatch(patch: SpectralPatch): void {
  try {
    localStorage.setItem(LAST_PATCH_KEY, JSON.stringify(patch))
  } catch {
    /* storage unavailable (private mode, quota) — autosave is best-effort. */
  }
}

/** Restore the last-session patch, or undefined when absent/unreadable. */
export function loadLastPatch(): SpectralPatch | undefined {
  try {
    const raw = localStorage.getItem(LAST_PATCH_KEY)
    if (!raw) return undefined
    return sanitizePatch(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Forget the stored last session. Never throws. */
export function clearLastPatch(): void {
  try {
    localStorage.removeItem(LAST_PATCH_KEY)
  } catch {
    /* ignore */
  }
}
