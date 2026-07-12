/**
 * Microphone / line-input source adapter via getUserMedia, plus input-device
 * enumeration for a device picker.
 *
 * Constraints disable the browser's input DSP (echo cancellation / noise
 * suppression / automatic gain) and request stereo, because mspectr analyses the
 * raw signal — adapted directly from mscope/src/audio/input/MicrophoneInput.ts.
 *
 * Because acquisition is async and a caller may switch sources before
 * getUserMedia resolves, {@link createMicSource} takes a `cancelled` predicate
 * (the generation-counter pattern proven in mscope/src/audio/input/BaseInput.ts):
 * if the request was superseded while pending, the resolved-but-orphaned stream
 * is stopped immediately and never connected. dispose() stops all tracks and
 * disconnects the node.
 */

import type { SourceHandle } from './types'

/**
 * Thrown when an in-flight acquisition was superseded (the caller switched
 * source / disposed before getUserMedia resolved). The orphaned stream's tracks
 * are already stopped; callers should swallow this rather than surface it as a
 * permission/acquisition failure.
 */
export class MicAcquisitionCancelledError extends Error {
  constructor() {
    super('Microphone acquisition was cancelled by a newer source selection.')
    this.name = 'MicAcquisitionCancelledError'
  }
}

/**
 * Enumerate available audio input devices for a picker. Returns [] when device
 * enumeration is unavailable. Labels are only populated after a prior permission
 * grant (browser privacy behaviour) — callers should fall back to deviceId.
 */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}

/**
 * Acquire a microphone/line input as a started, connected MediaStreamSource.
 * Pass a `deviceId` (from {@link listInputDevices}) to pin a specific device.
 * Throws on permission denial / acquisition failure.
 *
 * Because the handle (and therefore dispose()) only exists once getUserMedia
 * resolves, a caller cannot tear down an in-flight acquisition itself. Pass
 * `cancelled` (e.g. a generation-token check) so a superseded request stops the
 * just-resolved stream's tracks — releasing the device and mic indicator —
 * instead of leaving it hot and orphaned; it then throws
 * {@link MicAcquisitionCancelledError}.
 */
export async function createMicSource(
  ctx: AudioContext,
  deviceId?: string,
  cancelled?: () => boolean,
): Promise<SourceHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      deviceId: deviceId ? { exact: deviceId } : undefined,
    },
  })

  // Superseded while getUserMedia was pending: release the device immediately
  // so the mic indicator turns off, and never wire the stale stream.
  if (cancelled?.()) {
    stream.getTracks().forEach((t) => t.stop())
    throw new MicAcquisitionCancelledError()
  }

  const track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('The selected input did not provide an audio track.')
  }

  const node = ctx.createMediaStreamSource(stream)

  let disposed = false
  return {
    id: deviceId ? `mic:${deviceId}` : 'mic',
    kind: 'microphone',
    label: track.label || 'Microphone',
    node,
    // Live streams have no decoded buffer to preview.
    waveformPreview: null,
    dispose(): void {
      if (disposed) return
      disposed = true
      // Teardown order mirrors mscope BaseInput: disconnect the node, then stop
      // every track so the OS releases the device.
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
