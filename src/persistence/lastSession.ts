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
import {
  sanitizePatch,
  sanitizePersistedSource,
  type PersistedSource,
  type SpectralPatch,
} from '../audio/contracts'

export const LAST_PATCH_KEY = 'mspectr.lastPatch'

/** A restored last session: the sanitized patch plus when it was saved. */
export interface LastSession {
  patch: SpectralPatch
  /** ms since epoch, or null for legacy saves that predate the timestamp. */
  savedAt: number | null
  /** The active source when saved, or null for legacy/unknown saves. */
  source: PersistedSource | null
}

/** Persist the current patch (and its source) as the "last session". Never throws. */
export function saveLastPatch(patch: SpectralPatch, source?: PersistedSource | null): void {
  try {
    // Wrap with a savedAt stamp so the launch screen can show when the last
    // session was left off. loadLastSession still reads the legacy bare-patch
    // shape written by earlier versions.
    localStorage.setItem(LAST_PATCH_KEY, JSON.stringify({ patch, savedAt: Date.now(), source: source ?? null }))
  } catch {
    /* storage unavailable (private mode, quota) — autosave is best-effort. */
  }
}

/** Restore the last session (patch + timestamp + source), or undefined when absent/unreadable. */
export function loadLastSession(): LastSession | undefined {
  try {
    const raw = localStorage.getItem(LAST_PATCH_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    // New shape: { patch, savedAt, source? }. Legacy shape: the bare patch object.
    const isWrapped = parsed && typeof parsed === 'object' && 'patch' in parsed
    const source = isWrapped ? parsed.patch : parsed
    const savedAt = isWrapped && typeof parsed.savedAt === 'number' ? parsed.savedAt : null
    const persistedSource = isWrapped ? sanitizePersistedSource(parsed.source) : null
    return { patch: sanitizePatch(source), savedAt, source: persistedSource }
  } catch {
    return undefined
  }
}

/** Restore just the last-session patch, or undefined when absent/unreadable. */
export function loadLastPatch(): SpectralPatch | undefined {
  return loadLastSession()?.patch
}

/** Forget the stored last session. Never throws. */
export function clearLastPatch(): void {
  try {
    localStorage.removeItem(LAST_PATCH_KEY)
  } catch {
    /* ignore */
  }
}
