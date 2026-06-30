/**
 * File source adapter. A user-picked audio File is read entirely in the browser
 * (File.arrayBuffer), decoded with the AudioContext (decodeAudioData), and wrapped
 * as a looping AudioBufferSourceNode. Nothing is ever uploaded — there is no
 * network access anywhere in this module; the bytes never leave the page.
 *
 * Adapted from mscope/src/audio/input/FileInput.ts: the read→decode→looping-buffer
 * flow and the `decodeAudioData(bytes.slice(0))` copy (real implementations detach
 * the passed ArrayBuffer, which would corrupt any later reuse) are taken from
 * there, collapsed into a single async factory that returns a SourceHandle.
 */

import type { SourceHandle } from './types'
import { decimateWaveform } from './generated'

/**
 * Mix down (or pass through) the decoded channels to a single mono Float32Array
 * for the preview. Averaging keeps the overview representative of the full mix.
 */
function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  if (channels === 1) return buffer.getChannelData(0)
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) mono[i] += data[i]
  }
  const inv = 1 / channels
  for (let i = 0; i < length; i++) mono[i] *= inv
  return mono
}

/**
 * Decode a local audio File and build a started, looping source. Throws if the
 * file cannot be read or decoded (caller surfaces the message to the user).
 */
export async function createFileSource(ctx: AudioContext, file: File): Promise<SourceHandle> {
  // Read the picked file into memory. This is a local FileReader-style read; no
  // request is made to any server.
  const bytes = await file.arrayBuffer()

  // slice(0) hands decodeAudioData a copy: real implementations detach (neuter)
  // the passed buffer, which would make the original bytes unusable afterwards.
  const buffer = await ctx.decodeAudioData(bytes.slice(0))

  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.loop = true
  node.start()

  const preview = decimateWaveform(toMono(buffer))

  let disposed = false
  return {
    id: `file:${file.name}`,
    kind: 'file',
    label: file.name,
    node,
    waveformPreview: preview,
    dispose(): void {
      if (disposed) return
      disposed = true
      try {
        node.stop()
      } catch {
        // Already stopped / never fully started; ignore.
      }
      node.disconnect()
    },
  }
}
