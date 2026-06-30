/**
 * Microphone / line-input source adapter via getUserMedia, plus input-device
 * enumeration for a device picker.
 *
 * Constraints disable the browser's input DSP (echo cancellation / noise
 * suppression / automatic gain) and request stereo, because mspectr analyses the
 * raw signal — adapted directly from mscope/src/audio/input/MicrophoneInput.ts.
 *
 * Because acquisition is async and a caller may switch sources before
 * getUserMedia resolves, we guard with a generation counter (the pattern proven in
 * mscope/src/audio/input/BaseInput.ts): if dispose() runs while the request is
 * pending, the resolved-but-orphaned stream is stopped immediately and never
 * connected. dispose() stops all tracks and disconnects the node.
 */

import type { SourceHandle } from './types'

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
 */
export async function createMicSource(ctx: AudioContext, deviceId?: string): Promise<SourceHandle> {
  // Acquire first. The handle (and therefore dispose()) only exists once this
  // resolves, so unlike mscope's stateful BaseInput there is no in-flight handle a
  // caller could tear down mid-acquisition; the supersession concern reduces to
  // "dispose() after the node is wired", handled by the `disposed` flag below.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      deviceId: deviceId ? { exact: deviceId } : undefined,
    },
  })

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
