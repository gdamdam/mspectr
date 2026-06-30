import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFileSource } from './file'

// ---------------------------------------------------------------------------
// Minimal mocks for the node test environment: an AudioBuffer-ish object, a
// buffer source node, and an AudioContext whose decodeAudioData resolves a fake
// stereo buffer. We assert the file path never touches the network.
// ---------------------------------------------------------------------------

class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  private readonly channels: Float32Array[]
  constructor(channelData: Float32Array[], sampleRate: number) {
    this.numberOfChannels = channelData.length
    this.length = channelData[0]?.length ?? 0
    this.sampleRate = sampleRate
    this.channels = channelData
  }
  getChannelData(ch: number): Float32Array {
    return this.channels[ch]
  }
}

class MockBufferSource {
  buffer: unknown = null
  loop = false
  started = 0
  stopped = 0
  disconnected = 0
  start(): void {
    this.started++
  }
  stop(): void {
    this.stopped++
  }
  disconnect(): void {
    this.disconnected++
  }
}

function makeDecodedBuffer(length: number): MockAudioBuffer {
  // Two channels with a simple ramp so the mono mixdown is non-trivial.
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    left[i] = Math.sin(i * 0.01)
    right[i] = Math.sin(i * 0.01 + 0.5)
  }
  return new MockAudioBuffer([left, right], 48000)
}

interface MockCtxOptions {
  bufferLength?: number
  decodeImpl?: (bytes: ArrayBuffer) => Promise<MockAudioBuffer>
}

function makeCtx(opts: MockCtxOptions = {}): {
  ctx: AudioContext
  decode: ReturnType<typeof vi.fn>
  lastSource: () => MockBufferSource | null
} {
  let lastSource: MockBufferSource | null = null
  const bufferLength = opts.bufferLength ?? 4096
  const decode = vi.fn(
    opts.decodeImpl ?? (async () => makeDecodedBuffer(bufferLength)),
  )
  const ctx = {
    decodeAudioData: decode,
    createBufferSource(): MockBufferSource {
      lastSource = new MockBufferSource()
      return lastSource
    },
  } as unknown as AudioContext
  return { ctx, decode, lastSource: () => lastSource }
}

function makeFile(name = 'clip.wav', byteLength = 2048): File {
  const bytes = new Uint8Array(byteLength)
  for (let i = 0; i < byteLength; i++) bytes[i] = i & 0xff
  // Provide an arrayBuffer() that resolves the bytes; a real File has this.
  const file = {
    name,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(0)),
  }
  return file as unknown as File
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createFileSource', () => {
  it('decodes locally and returns a started, looping handle', async () => {
    const { ctx, decode, lastSource } = makeCtx()
    const file = makeFile('song.mp3')
    const handle = await createFileSource(ctx, file)

    expect(decode).toHaveBeenCalledTimes(1)
    expect(handle.kind).toBe('file')
    expect(handle.label).toBe('song.mp3')
    expect(handle.id).toBe('file:song.mp3')
    const node = lastSource()!
    expect(node.loop).toBe(true)
    expect(node.started).toBe(1)
  })

  it('builds a decimated waveform preview of ~1024 points', async () => {
    const { ctx } = makeCtx({ bufferLength: 50000 })
    const handle = await createFileSource(ctx, makeFile())
    expect(handle.waveformPreview).not.toBeNull()
    expect(handle.waveformPreview!.length).toBe(1024)
    for (const v of handle.waveformPreview!) expect(Number.isFinite(v)).toBe(true)
  })

  it('preview length is capped to the buffer length for tiny files', async () => {
    const { ctx } = makeCtx({ bufferLength: 100 })
    const handle = await createFileSource(ctx, makeFile())
    expect(handle.waveformPreview!.length).toBe(100)
  })

  it('never touches the network (no fetch / XHR / WebSocket)', async () => {
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    const wsSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)
    vi.stubGlobal('WebSocket', wsSpy)

    const { ctx } = makeCtx()
    await createFileSource(ctx, makeFile())

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(wsSpy).not.toHaveBeenCalled()
  })

  it('passes a detached copy (slice) to decodeAudioData, not the original bytes', async () => {
    let received: ArrayBuffer | null = null
    const { ctx } = makeCtx({
      decodeImpl: async (bytes) => {
        received = bytes
        return makeDecodedBuffer(2048)
      },
    })
    const file = makeFile('a.wav', 1234)
    const original = await file.arrayBuffer()
    await createFileSource(ctx, file)
    expect(received).not.toBeNull()
    // A copy, not the same reference handed straight through.
    expect(received).not.toBe(original)
    expect(received!.byteLength).toBe(1234)
  })

  it('propagates a decode failure', async () => {
    const { ctx } = makeCtx({
      decodeImpl: async () => {
        throw new Error('Unsupported format')
      },
    })
    await expect(createFileSource(ctx, makeFile())).rejects.toThrow('Unsupported format')
  })

  it('dispose stops and disconnects once (idempotent)', async () => {
    const { ctx, lastSource } = makeCtx()
    const handle = await createFileSource(ctx, makeFile())
    handle.dispose()
    handle.dispose()
    const node = lastSource()!
    expect(node.stopped).toBe(1)
    expect(node.disconnected).toBe(1)
  })
})
