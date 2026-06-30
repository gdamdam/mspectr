/**
 * Tab/screen audio source adapter via getDisplayMedia.
 *
 * `video: true` is requested because several browsers only surface the "Share tab
 * audio" option (and thus an audio track) when video sharing is also requested;
 * we immediately stop the video track(s) once acquired and keep only the audio.
 * If the share carries no audio track (the user didn't tick "Share tab audio"),
 * we stop everything and throw a clear, actionable error.
 *
 * Adapted from mscope/src/audio/input/TabCaptureInput.ts (the video-required /
 * audio-only acquisition and the no-audio-track guard) with the BaseInput teardown
 * ordering (disconnect node, then stop tracks), flattened into a SourceHandle.
 */

import type { SourceHandle } from './types'

const NO_AUDIO_MESSAGE = "No audio track — re-share and enable 'Share tab audio'."

/**
 * Acquire tab/screen audio as a started, connected MediaStreamSource. The video
 * track is dropped immediately; only audio feeds the engine. Throws with a clear
 * message when no audio track is present.
 */
export async function createTabSource(ctx: AudioContext): Promise<SourceHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  })

  const audioTrack = stream.getAudioTracks()[0]
  if (!audioTrack) {
    // No audio means nothing for the spectral engine to analyse — tear it down.
    stream.getTracks().forEach((t) => t.stop())
    throw new Error(NO_AUDIO_MESSAGE)
  }

  // We never render captured video; stop it so the browser drops the capture
  // overhead and only the audio track remains.
  stream.getVideoTracks().forEach((t) => t.stop())

  const node = ctx.createMediaStreamSource(stream)

  let disposed = false
  return {
    id: 'tab',
    kind: 'tab',
    label: audioTrack.label || 'Tab Audio',
    node,
    waveformPreview: null,
    dispose(): void {
      if (disposed) return
      disposed = true
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
