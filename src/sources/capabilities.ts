/**
 * Honest, side-effect-free feature detection for the optional source kinds.
 *
 * These are queried by the UI to enable/disable controls before the user commits
 * to a permission prompt, mirroring the capability checks in mscope's App.tsx
 * (which gates the tab-capture and device-picker affordances the same way). Each
 * predicate only inspects the presence of the relevant API — it never calls it,
 * so detection is cheap and never triggers a permission dialog.
 *
 * All guards funnel through `navigator` lookups behind `typeof` so they are safe
 * to evaluate in a non-DOM (node/test) context, returning false rather than
 * throwing when `navigator` is absent.
 */

/** The minimal shape we probe on `navigator`, without depending on lib.dom typing. */
interface CapabilityNavigator {
  mediaDevices?: {
    getDisplayMedia?: unknown
    enumerateDevices?: unknown
    getUserMedia?: unknown
  }
  requestMIDIAccess?: unknown
}

function getNavigator(): CapabilityNavigator | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as unknown as CapabilityNavigator)
}

/** True when tab/screen audio capture (getDisplayMedia) is available. */
export function supportsTabCapture(): boolean {
  return Boolean(getNavigator()?.mediaDevices?.getDisplayMedia)
}

/** True when the Web MIDI API is exposed (does not request access). */
export function supportsWebMidi(): boolean {
  return Boolean(getNavigator()?.requestMIDIAccess)
}

/** True when input devices can be enumerated for a device picker. */
export function supportsInputDeviceSelection(): boolean {
  return Boolean(getNavigator()?.mediaDevices?.enumerateDevices)
}
