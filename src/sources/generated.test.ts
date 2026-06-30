import { describe, it, expect } from 'vitest'
import { GENERATED_SOURCE_IDS } from '../audio/contracts'
import type { GeneratedSourceId } from '../audio/contracts'
import { renderGeneratedBuffer, createGeneratedSource } from './generated'

// ---------------------------------------------------------------------------
// Minimal mock BaseAudioContext: only the surface renderGeneratedBuffer touches
// (sampleRate, createBuffer + the AudioBuffer copy/get-channel methods). Tests
// run in the node environment, so there is no real Web Audio implementation.
// ---------------------------------------------------------------------------

class MockAudioBuffer {
  private readonly channels: Float32Array[]
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  copyToChannel(src: Float32Array, ch: number): void {
    this.channels[ch].set(src)
  }
  getChannelData(ch: number): Float32Array {
    return this.channels[ch]
  }
}

class MockBufferSource {
  buffer: MockAudioBuffer | null = null
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

function makeCtx(sampleRate = 48000): AudioContext {
  return {
    sampleRate,
    createBuffer(numberOfChannels: number, length: number, sr: number): MockAudioBuffer {
      return new MockAudioBuffer(numberOfChannels, length, sr)
    },
    createBufferSource(): MockBufferSource {
      return new MockBufferSource()
    },
  } as unknown as AudioContext
}

function channel(buffer: AudioBuffer): Float32Array {
  return buffer.getChannelData(0)
}

describe('renderGeneratedBuffer', () => {
  it('is deterministic: same id renders bit-identical samples', () => {
    for (const id of GENERATED_SOURCE_IDS) {
      const a = channel(renderGeneratedBuffer(makeCtx(), id))
      const b = channel(renderGeneratedBuffer(makeCtx(), id))
      expect(a.length).toBe(b.length)
      expect(a.length).toBeGreaterThan(0)
      // Float32Array equality is exact here — no RNG/Date.now nondeterminism.
      expect(Array.from(a)).toEqual(Array.from(b))
    }
  })

  it('produces distinct output per source id', () => {
    const samples: Record<string, Float32Array> = {}
    for (const id of GENERATED_SOURCE_IDS) samples[id] = channel(renderGeneratedBuffer(makeCtx(), id))
    const ids = GENERATED_SOURCE_IDS
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(Array.from(samples[ids[i]])).not.toEqual(Array.from(samples[ids[j]]))
      }
    }
  })

  it('every sample is finite', () => {
    for (const id of GENERATED_SOURCE_IDS) {
      const data = channel(renderGeneratedBuffer(makeCtx(), id))
      let firstNonFinite = -1
      for (let i = 0; i < data.length; i++) {
        if (!Number.isFinite(data[i])) {
          firstNonFinite = i
          break
        }
      }
      // Keep assertion count proportional to source count. An expect per sample
      // adds hundreds of thousands of Vitest assertions and can time out in CI.
      expect(firstNonFinite, `${id} has a non-finite sample`).toBe(-1)
    }
  })

  it('peak-normalises to ~-6 dBFS', () => {
    for (const id of GENERATED_SOURCE_IDS) {
      const data = channel(renderGeneratedBuffer(makeCtx(), id))
      let peak = 0
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
      // Target peak is 0.5 (≈ -6 dBFS); allow a small tolerance.
      expect(peak).toBeGreaterThan(0.45)
      expect(peak).toBeLessThanOrEqual(0.5 + 1e-6)
      // Never exceeds full scale.
      expect(peak).toBeLessThan(1)
    }
  })

  it('has no DC offset (mean ~ 0)', () => {
    for (const id of GENERATED_SOURCE_IDS) {
      const data = channel(renderGeneratedBuffer(makeCtx(), id))
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const mean = sum / data.length
      expect(Math.abs(mean)).toBeLessThan(1e-3)
    }
  })

  it('respects the seconds override (length scales, minus loop crossfade)', () => {
    const id: GeneratedSourceId = 'harmonic-string'
    const sr = 48000
    const oneSec = channel(renderGeneratedBuffer(makeCtx(sr), id, 1)).length
    const twoSec = channel(renderGeneratedBuffer(makeCtx(sr), id, 2)).length
    // Each is (seconds*sr) after the crossfade fold; difference is ~1 second.
    expect(twoSec - oneSec).toBe(sr)
    expect(oneSec).toBe(sr)
  })
})

describe('createGeneratedSource', () => {
  it('returns a started, looping handle with a decimated preview', () => {
    const ctx = makeCtx()
    const handle = createGeneratedSource(ctx, 'metallic-strike')
    expect(handle.kind).toBe('generated')
    expect(handle.id).toBe('metallic-strike')
    expect(handle.label.length).toBeGreaterThan(0)
    const node = handle.node as unknown as MockBufferSource
    expect(node.loop).toBe(true)
    expect(node.started).toBe(1)
    expect(handle.waveformPreview).not.toBeNull()
    expect(handle.waveformPreview!.length).toBe(1024)
  })

  it('dispose stops and disconnects exactly once (idempotent)', () => {
    const handle = createGeneratedSource(makeCtx(), 'noise-reed')
    const node = handle.node as unknown as MockBufferSource
    handle.dispose()
    handle.dispose()
    expect(node.stopped).toBe(1)
    expect(node.disconnected).toBe(1)
  })
})
