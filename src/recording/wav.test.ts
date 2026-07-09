import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encodeWavStereo } from './wav'
import type { WavMetadata } from './wav'
import { WavRecorder, recordingFilename } from './wavRecorder'

// ---------------------------------------------------------------------------
// Small RIFF reader so tests assert on real parsed header values, not offsets.
// ---------------------------------------------------------------------------

function readString(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

interface ParsedWav {
  riff: string
  riffSize: number
  wave: string
  fmtId: string
  fmtSize: number
  audioFormat: number
  numChannels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitDepth: number
  dataId: string
  dataSize: number
  dataOffset: number
  totalSize: number
  hasInfo: boolean
}

/** Parse just enough of the RIFF container to validate the header chunks. */
function parseWav(buf: ArrayBuffer): ParsedWav {
  const view = new DataView(buf)
  const riff = readString(view, 0, 4)
  const riffSize = view.getUint32(4, true)
  const wave = readString(view, 8, 4)
  const fmtId = readString(view, 12, 4)
  const fmtSize = view.getUint32(16, true)
  const audioFormat = view.getUint16(20, true)
  const numChannels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const byteRate = view.getUint32(28, true)
  const blockAlign = view.getUint16(32, true)
  const bitDepth = view.getUint16(34, true)

  // Walk chunks after fmt to find data (and note any LIST/INFO).
  let offset = 36
  let hasInfo = false
  let dataId = ''
  let dataSize = 0
  let dataOffset = 0
  while (offset + 8 <= buf.byteLength) {
    const id = readString(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'LIST') hasInfo = true
    if (id === 'data') {
      dataId = id
      dataSize = size
      dataOffset = offset + 8
      break
    }
    offset += 8 + size + (size % 2)
  }

  return {
    riff,
    riffSize,
    wave,
    fmtId,
    fmtSize,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitDepth,
    dataId,
    dataSize,
    dataOffset,
    totalSize: buf.byteLength,
    hasInfo,
  }
}

describe('encodeWavStereo — 16-bit header correctness', () => {
  it('writes correct RIFF/WAVE/fmt/data tags and sizes for stereo', () => {
    const frames = 100
    const L = new Float32Array(frames)
    const R = new Float32Array(frames)
    const buf = encodeWavStereo([L, R], 44100, 16)
    const w = parseWav(buf)

    expect(w.riff).toBe('RIFF')
    expect(w.wave).toBe('WAVE')
    expect(w.fmtId).toBe('fmt ')
    expect(w.fmtSize).toBe(16)
    expect(w.audioFormat).toBe(1) // PCM
    expect(w.numChannels).toBe(2)
    expect(w.sampleRate).toBe(44100)
    expect(w.bitDepth).toBe(16)
    expect(w.blockAlign).toBe(2 * 2) // channels * bytesPerSample
    expect(w.byteRate).toBe(44100 * 2 * 2)
    expect(w.dataId).toBe('data')
    expect(w.dataSize).toBe(frames * 2 * 2)
    expect(w.riffSize).toBe(w.totalSize - 8)
    expect(w.hasInfo).toBe(false)
  })

  it('encodes a mono fallback when given one channel', () => {
    const buf = encodeWavStereo([new Float32Array(50)], 48000, 16)
    const w = parseWav(buf)
    expect(w.numChannels).toBe(1)
    expect(w.blockAlign).toBe(2)
    expect(w.byteRate).toBe(48000 * 2)
    expect(w.dataSize).toBe(50 * 2)
  })

  it('round-trips a known sample value', () => {
    const L = Float32Array.from([0.5])
    const R = Float32Array.from([-0.5])
    const buf = encodeWavStereo([L, R], 44100, 16)
    const w = parseWav(buf)
    const view = new DataView(buf)
    // Interleaved: L then R at dataOffset. Encoder rounds (not truncates), so
    // 0.5*0x7fff = 16383.5 -> 16384 and -0.5*0x8000 = -16384 exactly.
    expect(view.getInt16(w.dataOffset, true)).toBe(Math.round(0.5 * 0x7fff))
    expect(view.getInt16(w.dataOffset + 2, true)).toBe(-0.5 * 0x8000)
  })
})

describe('encodeWavStereo — 24-bit header correctness', () => {
  it('writes 24-bit fmt fields, block align and byte rate', () => {
    const frames = 64
    const buf = encodeWavStereo([new Float32Array(frames), new Float32Array(frames)], 96000, 24)
    const w = parseWav(buf)

    expect(w.audioFormat).toBe(1)
    expect(w.bitDepth).toBe(24)
    expect(w.numChannels).toBe(2)
    expect(w.blockAlign).toBe(2 * 3)
    expect(w.byteRate).toBe(96000 * 2 * 3)
    expect(w.dataSize).toBe(frames * 2 * 3)
    expect(w.riffSize).toBe(w.totalSize - 8)
  })

  it('encodes a known positive and negative 24-bit sample (little-endian)', () => {
    const buf = encodeWavStereo([Float32Array.from([1, -1])], 44100, 24)
    const w = parseWav(buf)
    const view = new DataView(buf)
    const read24 = (off: number): number => {
      const lo = view.getUint8(off)
      const mid = view.getUint8(off + 1)
      const hi = view.getUint8(off + 2)
      let v = lo | (mid << 8) | (hi << 16)
      if (v & 0x800000) v -= 0x1000000 // sign-extend
      return v
    }
    expect(read24(w.dataOffset)).toBe(0x7fffff) // +1 full scale
    expect(read24(w.dataOffset + 3)).toBe(-0x800000) // -1 full scale
  })
})

describe('encodeWavStereo — sample clamping', () => {
  it('clamps samples beyond +/-1 to full scale (16-bit)', () => {
    const buf = encodeWavStereo([Float32Array.from([2, -2, 1, -1])], 44100, 16)
    const w = parseWav(buf)
    const view = new DataView(buf)
    expect(view.getInt16(w.dataOffset, true)).toBe(0x7fff) // 2 -> +1
    expect(view.getInt16(w.dataOffset + 2, true)).toBe(-0x8000) // -2 -> -1
    expect(view.getInt16(w.dataOffset + 4, true)).toBe(0x7fff) // 1
    expect(view.getInt16(w.dataOffset + 6, true)).toBe(-0x8000) // -1
  })

  it('clamps NaN/Infinity sanely (16-bit) without overflowing the buffer', () => {
    const buf = encodeWavStereo([Float32Array.from([Infinity, -Infinity, NaN])], 44100, 16)
    const w = parseWav(buf)
    const view = new DataView(buf)
    expect(view.getInt16(w.dataOffset, true)).toBe(0x7fff) // +Inf -> +1
    expect(view.getInt16(w.dataOffset + 2, true)).toBe(-0x8000) // -Inf -> -1
    // NaN clamps to min via contracts.clamp comparison semantics; just assert in range.
    const nanVal = view.getInt16(w.dataOffset + 4, true)
    expect(nanVal).toBeGreaterThanOrEqual(-0x8000)
    expect(nanVal).toBeLessThanOrEqual(0x7fff)
  })

  it('clamps beyond +/-1 to full scale (24-bit)', () => {
    const buf = encodeWavStereo([Float32Array.from([5, -5])], 44100, 24)
    const w = parseWav(buf)
    const view = new DataView(buf)
    const read24 = (off: number): number => {
      let v = view.getUint8(off) | (view.getUint8(off + 1) << 8) | (view.getUint8(off + 2) << 16)
      if (v & 0x800000) v -= 0x1000000
      return v
    }
    expect(read24(w.dataOffset)).toBe(0x7fffff)
    expect(read24(w.dataOffset + 3)).toBe(-0x800000)
  })
})

describe('encodeWavStereo — LIST/INFO metadata', () => {
  it('embeds a LIST/INFO chunk when metadata is provided', () => {
    const meta: WavMetadata = { title: 'Glass Memory', artist: 'gio', software: 'mspectr' }
    const buf = encodeWavStereo([new Float32Array(10), new Float32Array(10)], 44100, 16, meta)
    const w = parseWav(buf)
    expect(w.hasInfo).toBe(true)
    expect(w.dataId).toBe('data') // data chunk still locatable after INFO
    expect(w.riffSize).toBe(w.totalSize - 8)

    // The INFO body should contain the tag ids and strings.
    const bytes = new Uint8Array(buf)
    const text = String.fromCharCode(...bytes)
    expect(text).toContain('LIST')
    expect(text).toContain('INFO')
    expect(text).toContain('INAM')
    expect(text).toContain('Glass Memory')
    expect(text).toContain('IART')
    expect(text).toContain('ISFT')
  })

  it('omits the INFO chunk entirely when meta has no usable fields', () => {
    const buf = encodeWavStereo([new Float32Array(4)], 44100, 16, {})
    expect(parseWav(buf).hasInfo).toBe(false)
  })
})

describe('recordingFilename', () => {
  it('formats label + injected date as mspectr-<slug>-YYYY-MM-DD-HHMM.wav', () => {
    const date = new Date(2026, 5, 30, 14, 32) // 2026-06-30 14:32 local
    expect(recordingFilename('Glass Memory', date)).toBe('mspectr-glass-memory-2026-06-30-1432.wav')
  })

  it('slugifies punctuation and collapses separators', () => {
    const date = new Date(2026, 0, 1, 9, 5)
    expect(recordingFilename('  Hello, World!! ', date)).toBe('mspectr-hello-world-2026-01-01-0905.wav')
  })

  it('falls back to "recording" for an empty label', () => {
    const date = new Date(2026, 11, 9, 0, 0)
    expect(recordingFilename('', date)).toBe('mspectr-recording-2026-12-09-0000.wav')
  })
})

// ---------------------------------------------------------------------------
// WavRecorder — uses a mocked AudioContext with the ScriptProcessor fallback
// path (no AudioWorklet in node), so we exercise tap/connect/cleanup + caps.
// ---------------------------------------------------------------------------

class FakeAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeScriptProcessor extends FakeAudioNode {
  onaudioprocess: ((e: unknown) => void) | null = null
  constructor(public bufferSize: number) {
    super()
  }
  /** Drive a render quantum with the given per-channel data. */
  emit(channels: Float32Array[]): void {
    this.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: channels.length,
        getChannelData: (c: number) => channels[c],
      },
    })
  }
}

class FakeGain extends FakeAudioNode {
  gain = { value: 1 }
}

function makeCtx(sampleRate = 48000): {
  ctx: AudioContext
  lastScript: () => FakeScriptProcessor | null
} {
  let lastScript: FakeScriptProcessor | null = null
  const ctx = {
    sampleRate,
    destination: new FakeAudioNode(),
    // No audioWorklet property → recorder takes the ScriptProcessor path.
    createScriptProcessor: (size: number) => {
      lastScript = new FakeScriptProcessor(size)
      return lastScript as unknown as ScriptProcessorNode
    },
    createGain: () => new FakeGain() as unknown as GainNode,
  } as unknown as AudioContext
  return { ctx, lastScript: () => lastScript }
}

describe('WavRecorder (ScriptProcessor fallback)', () => {
  beforeEach(() => {
    // Provide a window with pagehide support for listener wiring.
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connects the tap, captures audio, and produces a wav Blob on stop', async () => {
    const { ctx, lastScript } = makeCtx(48000)
    const tap = new FakeAudioNode()
    const rec = new WavRecorder(ctx, tap as unknown as AudioNode, { bitDepth: 16 })
    expect(rec.recording).toBe(false)

    await rec.start()
    expect(rec.recording).toBe(true)
    expect(tap.connect).toHaveBeenCalled()

    const sp = lastScript()!
    sp.emit([new Float32Array(128).fill(0.5), new Float32Array(128).fill(-0.5)])
    expect(rec.elapsedSeconds).toBeCloseTo(128 / 48000, 6)

    const blob = await rec.stop()
    expect(blob.type).toBe('audio/wav')
    expect(rec.recording).toBe(false)
    expect(tap.disconnect).toHaveBeenCalled()

    const ab = await blob.arrayBuffer()
    const w = parseWav(ab)
    expect(w.numChannels).toBe(2)
    expect(w.sampleRate).toBe(48000)
    expect(w.dataSize).toBe(128 * 2 * 2)
  })

  it('shares one finalization across concurrent stop calls', async () => {
    const { ctx, lastScript } = makeCtx(48000)
    const rec = new WavRecorder(ctx, new FakeAudioNode() as unknown as AudioNode)
    await rec.start()
    lastScript()!.emit([new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.25)])
    const first = rec.stop()
    const second = rec.stop()
    expect(second).toBe(first)
    const [a, b] = await Promise.all([first, second])
    expect(b).toBe(a)
    expect(parseWav(await a.arrayBuffer()).dataSize).toBe(128 * 2 * 2)
  })

  it('reports progress and caps capture at maxSeconds', async () => {
    const { ctx, lastScript } = makeCtx(1000) // 1000 Hz → easy frame math
    const tap = new FakeAudioNode()
    const rec = new WavRecorder(ctx, tap as unknown as AudioNode, { bitDepth: 16, maxSeconds: 1 })
    const progress: Array<[number, number]> = []
    rec.onProgress((s, b) => progress.push([s, b]))

    await rec.start()
    const sp = lastScript()!
    // 1 second cap = 1000 frames. Feed 800 then 800 (overshoot).
    sp.emit([new Float32Array(800).fill(0.1), new Float32Array(800).fill(0.1)])
    sp.emit([new Float32Array(800).fill(0.1), new Float32Array(800).fill(0.1)])

    // Auto-stopped at the cap; only 1000 frames retained.
    expect(rec.recording).toBe(false)
    expect(rec.elapsedSeconds).toBeCloseTo(1, 6)
    expect(progress.length).toBeGreaterThan(0)
    expect(tap.disconnect).toHaveBeenCalled()

    const blob = await rec.stop()
    const w = parseWav(await blob.arrayBuffer())
    expect(w.dataSize).toBe(1000 * 2 * 2)
  })

  it('cancel() discards audio and frees nodes without producing a blob', async () => {
    const { ctx, lastScript } = makeCtx()
    const tap = new FakeAudioNode()
    const rec = new WavRecorder(ctx, tap as unknown as AudioNode)
    await rec.start()
    lastScript()!.emit([new Float32Array(256), new Float32Array(256)])
    rec.cancel()
    expect(rec.recording).toBe(false)
    expect(rec.elapsedSeconds).toBe(0)
    expect(tap.disconnect).toHaveBeenCalled()
  })

  it('registers and removes a pagehide listener over its lifecycle', () => {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    vi.stubGlobal('window', { addEventListener: addSpy, removeEventListener: removeSpy })
    const { ctx } = makeCtx()
    const rec = new WavRecorder(ctx, new FakeAudioNode() as unknown as AudioNode)
    expect(addSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
    rec.dispose()
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
  })

  it('memoizes recorder worklet modules per AudioContext', async () => {
    class FakeWorkletNode extends FakeAudioNode {
      port = { onmessage: null, postMessage: vi.fn() }
    }
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    const makeWorkletCtx = () => {
      const addModule = vi.fn(() => Promise.resolve())
      const ctx = {
        sampleRate: 48000,
        audioWorklet: { addModule },
      } as unknown as AudioContext
      return { ctx, addModule }
    }
    const a = makeWorkletCtx()
    const b = makeWorkletCtx()
    const a1 = new WavRecorder(a.ctx, new FakeAudioNode() as unknown as AudioNode)
    await a1.start()
    a1.cancel()
    const a2 = new WavRecorder(a.ctx, new FakeAudioNode() as unknown as AudioNode)
    await a2.start()
    a2.cancel()
    const b1 = new WavRecorder(b.ctx, new FakeAudioNode() as unknown as AudioNode)
    await b1.start()
    b1.cancel()
    expect(a.addModule).toHaveBeenCalledTimes(1)
    expect(b.addModule).toHaveBeenCalledTimes(1)
  })
})
