import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  supportsTabCapture,
  supportsWebMidi,
  supportsInputDeviceSelection,
} from './capabilities'

// The capability predicates inspect the global `navigator`. We stub it per-test
// with vi.stubGlobal and restore afterwards so the node default (no navigator) is
// honoured between cases.
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('capability detection — features present', () => {
  it('reports all capabilities when the APIs exist', () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: () => {},
        enumerateDevices: () => {},
        getUserMedia: () => {},
      },
      requestMIDIAccess: () => {},
    })
    expect(supportsTabCapture()).toBe(true)
    expect(supportsWebMidi()).toBe(true)
    expect(supportsInputDeviceSelection()).toBe(true)
  })
})

describe('capability detection — features absent', () => {
  it('returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined)
    expect(supportsTabCapture()).toBe(false)
    expect(supportsWebMidi()).toBe(false)
    expect(supportsInputDeviceSelection()).toBe(false)
  })

  it('returns false when mediaDevices is missing', () => {
    vi.stubGlobal('navigator', {})
    expect(supportsTabCapture()).toBe(false)
    expect(supportsInputDeviceSelection()).toBe(false)
    expect(supportsWebMidi()).toBe(false)
  })

  it('detects each capability independently', () => {
    // Only device enumeration present.
    vi.stubGlobal('navigator', {
      mediaDevices: { enumerateDevices: () => {} },
    })
    expect(supportsInputDeviceSelection()).toBe(true)
    expect(supportsTabCapture()).toBe(false)
    expect(supportsWebMidi()).toBe(false)
  })

  it('detects tab capture without midi or enumeration', () => {
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: () => {} },
    })
    expect(supportsTabCapture()).toBe(true)
    expect(supportsInputDeviceSelection()).toBe(false)
    expect(supportsWebMidi()).toBe(false)
  })
})
