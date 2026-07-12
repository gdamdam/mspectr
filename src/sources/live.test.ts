import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMicSource, MicAcquisitionCancelledError } from './live'

// ---------------------------------------------------------------------------
// Minimal mocks for the node test environment: a MediaStream-ish object with
// stoppable tracks, a deferred getUserMedia so tests control when acquisition
// resolves, and an AudioContext that records createMediaStreamSource calls.
// ---------------------------------------------------------------------------

interface MockTrack {
  kind: string
  label: string
  stop: ReturnType<typeof vi.fn>
}

function makeTrack(label = 'Mock Mic'): MockTrack {
  return { kind: 'audio', label, stop: vi.fn() }
}

function makeStream(tracks: MockTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getTracks: () => tracks,
  } as unknown as MediaStream
}

/** Stub navigator.mediaDevices.getUserMedia with a deferred promise. */
function stubGetUserMedia(): {
  gum: ReturnType<typeof vi.fn>
  resolve: (stream: MediaStream) => void
  reject: (err: unknown) => void
} {
  let resolve!: (stream: MediaStream) => void
  let reject!: (err: unknown) => void
  const gum = vi.fn(
    () =>
      new Promise<MediaStream>((res, rej) => {
        resolve = res
        reject = rej
      }),
  )
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
  return { gum, resolve: (s) => resolve(s), reject: (e) => reject(e) }
}

class MockStreamSourceNode {
  disconnected = 0
  disconnect(): void {
    this.disconnected++
  }
}

function makeCtx(): { ctx: AudioContext; created: MediaStream[] } {
  const created: MediaStream[] = []
  const ctx = {
    createMediaStreamSource(stream: MediaStream): MockStreamSourceNode {
      created.push(stream)
      return new MockStreamSourceNode()
    },
  } as unknown as AudioContext
  return { ctx, created }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createMicSource', () => {
  it('returns a connected handle with the track label', async () => {
    const { resolve } = stubGetUserMedia()
    const { ctx, created } = makeCtx()
    const pending = createMicSource(ctx, 'dev-1')
    resolve(makeStream([makeTrack('USB Interface')]))
    const handle = await pending

    expect(handle.kind).toBe('microphone')
    expect(handle.label).toBe('USB Interface')
    expect(handle.id).toBe('mic:dev-1')
    expect(created).toHaveLength(1)
  })

  it('stops the resolved stream and rejects when superseded mid-acquisition', async () => {
    const { resolve } = stubGetUserMedia()
    const { ctx, created } = makeCtx()
    let superseded = false
    const pending = createMicSource(ctx, 'dev-1', () => superseded)

    // Caller switches source while getUserMedia is still pending...
    superseded = true
    // ...then the browser resolves the now-orphaned stream.
    const tracks = [makeTrack('a'), makeTrack('b')]
    resolve(makeStream(tracks))

    await expect(pending).rejects.toBeInstanceOf(MicAcquisitionCancelledError)
    // Every track was released so the mic indicator turns off.
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1)
    // The stale stream was never wired into the graph.
    expect(created).toHaveLength(0)
  })

  it('does not cancel when the predicate stays false', async () => {
    const { resolve } = stubGetUserMedia()
    const { ctx } = makeCtx()
    const track = makeTrack()
    const pending = createMicSource(ctx, undefined, () => false)
    resolve(makeStream([track]))
    const handle = await pending
    expect(handle.id).toBe('mic')
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('stops tracks and throws when the stream has no audio track', async () => {
    const { resolve } = stubGetUserMedia()
    const { ctx } = makeCtx()
    const video = makeTrack()
    video.kind = 'video'
    const pending = createMicSource(ctx)
    resolve(makeStream([video]))
    await expect(pending).rejects.toThrow('did not provide an audio track')
    expect(video.stop).toHaveBeenCalledTimes(1)
  })

  it('dispose stops every track and disconnects once (idempotent)', async () => {
    const { resolve } = stubGetUserMedia()
    const { ctx } = makeCtx()
    const tracks = [makeTrack('a'), makeTrack('b')]
    const pending = createMicSource(ctx)
    resolve(makeStream(tracks))
    const handle = await pending
    handle.dispose()
    handle.dispose()
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1)
    expect((handle.node as unknown as MockStreamSourceNode).disconnected).toBe(1)
  })

  it('propagates a permission denial', async () => {
    const { reject } = stubGetUserMedia()
    const { ctx } = makeCtx()
    const pending = createMicSource(ctx)
    reject(new Error('Permission denied'))
    await expect(pending).rejects.toThrow('Permission denied')
  })
})
