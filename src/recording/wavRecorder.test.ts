import { describe, it, expect, vi } from 'vitest'
import { WavRecorder } from './wavRecorder'

/**
 * These tests exercise the ScriptProcessor fallback path (no `audioWorklet` on
 * the fake context) so the auto-stop / finalize / callback lifecycle can be
 * driven deterministically by pushing render blocks through `onaudioprocess`.
 * The worklet path shares the same buffering + autoStop code, differing only in
 * how chunks arrive.
 */

interface FakeScriptNode {
  onaudioprocess: ((e: unknown) => void) | null
  connect: () => void
  disconnect: () => void
}

function makeCtx(sampleRate = 48_000) {
  const created: { script: FakeScriptNode[] } = { script: [] }
  const ctx = {
    sampleRate,
    // No `audioWorklet` → WavRecorder falls back to a ScriptProcessorNode.
    destination: {},
    createScriptProcessor(): FakeScriptNode {
      const node: FakeScriptNode = { onaudioprocess: null, connect() {}, disconnect() {} }
      created.script.push(node)
      return node
    },
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} }
    },
  }
  return { ctx: ctx as unknown as AudioContext, created }
}

function makeTap(): AudioNode {
  return { connect() {}, disconnect() {} } as unknown as AudioNode
}

function feedBlock(node: FakeScriptNode, frames: number, channels = 2): void {
  const buffers = Array.from({ length: channels }, () => new Float32Array(frames).fill(0.1))
  node.onaudioprocess?.({
    inputBuffer: {
      numberOfChannels: channels,
      getChannelData: (c: number) => buffers[c],
    },
  })
}

describe('WavRecorder auto-stop lifecycle', () => {
  it('finalizes exactly once at the duration cap, exposes the WAV, and clears recording', async () => {
    const { ctx, created } = makeCtx(48_000)
    const rec = new WavRecorder(ctx, makeTap(), { bitDepth: 16, maxSeconds: 1 })
    const done = vi.fn()
    rec.onComplete(done)
    await rec.start()
    const node = created.script[0]
    expect(rec.recording).toBe(true)

    // maxFrames = 1s * 48000 = 48000. Feed 4096-frame blocks past the cap.
    for (let i = 0; i < 40 && rec.recording; i++) feedBlock(node, 4096)

    expect(done).toHaveBeenCalledTimes(1)
    const blob = done.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    // Capped at exactly maxFrames: 44-byte header + 48000 frames * 2ch * 2 bytes.
    expect(blob.size).toBe(44 + 48_000 * 2 * 2)
    expect(rec.recording).toBe(false)

    // Further audio after completion must not re-fire the callback.
    feedBlock(node, 4096)
    expect(done).toHaveBeenCalledTimes(1)
    rec.dispose()
  })

  it('does NOT fire onComplete for a manual stop(), which returns its own Blob', async () => {
    const { ctx, created } = makeCtx()
    const rec = new WavRecorder(ctx, makeTap(), { bitDepth: 16, maxSeconds: 60 })
    const done = vi.fn()
    rec.onComplete(done)
    await rec.start()
    feedBlock(created.script[0], 4096)

    const blob = await rec.stop()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(44)
    expect(done).not.toHaveBeenCalled()
    expect(rec.recording).toBe(false)
    rec.dispose()
  })

  it('does NOT fire onComplete on cancel() and discards audio', async () => {
    const { ctx, created } = makeCtx()
    const rec = new WavRecorder(ctx, makeTap(), { maxSeconds: 60 })
    const done = vi.fn()
    rec.onComplete(done)
    await rec.start()
    feedBlock(created.script[0], 4096)

    rec.cancel()
    expect(done).not.toHaveBeenCalled()
    expect(rec.recording).toBe(false)
    // A stop() after cancel yields an empty (header-only) WAV, never a callback.
    const blob = await rec.stop()
    expect(blob.size).toBe(44)
    expect(done).not.toHaveBeenCalled()
    rec.dispose()
  })

  it('reports monotonic progress derived from captured frames', async () => {
    const { ctx, created } = makeCtx(48_000)
    const rec = new WavRecorder(ctx, makeTap(), { maxSeconds: 60 })
    const seconds: number[] = []
    rec.onProgress((s) => seconds.push(s))
    await rec.start()
    feedBlock(created.script[0], 4096)
    feedBlock(created.script[0], 4096)
    expect(seconds.length).toBe(2)
    expect(seconds[1]).toBeGreaterThan(seconds[0])
    expect(seconds[0]).toBeCloseTo(4096 / 48_000, 5)
    rec.dispose()
  })
})
