import { describe, it, expect } from 'vitest'
import { parseMidiMessage } from './parse'

const u8 = (...bytes: number[]) => Uint8Array.from(bytes)

describe('parseMidiMessage', () => {
  it('decodes Note On', () => {
    expect(parseMidiMessage(u8(0x90, 60, 100))).toEqual({
      kind: 'noteOn',
      channel: 1,
      note: 60,
      velocity: 100,
    })
  })

  it('decodes Note On on a higher channel (channel is 1-based)', () => {
    expect(parseMidiMessage(u8(0x95, 64, 80))).toEqual({
      kind: 'noteOn',
      channel: 6,
      note: 64,
      velocity: 80,
    })
  })

  it('treats Note On with velocity 0 as Note Off', () => {
    expect(parseMidiMessage(u8(0x90, 60, 0))).toEqual({
      kind: 'noteOff',
      channel: 1,
      note: 60,
    })
  })

  it('decodes an explicit Note Off (0x80)', () => {
    expect(parseMidiMessage(u8(0x80, 60, 64))).toEqual({
      kind: 'noteOff',
      channel: 1,
      note: 60,
    })
  })

  it('decodes a generic Control Change', () => {
    expect(parseMidiMessage(u8(0xb0, 1, 90))).toEqual({
      kind: 'controlChange',
      channel: 1,
      controller: 1,
      value: 90,
    })
  })

  it('decodes the sustain pedal (CC 64) as a control change', () => {
    expect(parseMidiMessage(u8(0xb0, 64, 127))).toEqual({
      kind: 'controlChange',
      channel: 1,
      controller: 64,
      value: 127,
    })
  })

  it('maps CC 120 (All Sound Off) to allNotesOff', () => {
    expect(parseMidiMessage(u8(0xb0, 120, 0))).toEqual({
      kind: 'allNotesOff',
      channel: 1,
      controller: 120,
    })
  })

  it('maps CC 123 (All Notes Off) to allNotesOff', () => {
    expect(parseMidiMessage(u8(0xb2, 123, 0))).toEqual({
      kind: 'allNotesOff',
      channel: 3,
      controller: 123,
    })
  })

  describe('pitch bend', () => {
    it('decodes centre as value14=8192, normalized=0', () => {
      expect(parseMidiMessage(u8(0xe0, 0x00, 0x40))).toEqual({
        kind: 'pitchBend',
        channel: 1,
        value14: 8192,
        normalized: 0,
      })
    })

    it('decodes full-up as value14=16383, normalized=+1', () => {
      const ev = parseMidiMessage(u8(0xe0, 0x7f, 0x7f))
      expect(ev.kind).toBe('pitchBend')
      if (ev.kind !== 'pitchBend') throw new Error('expected pitchBend')
      expect(ev.value14).toBe(16383)
      expect(ev.normalized).toBeCloseTo(1, 10)
    })

    it('decodes full-down as value14=0, normalized=-1', () => {
      const ev = parseMidiMessage(u8(0xe0, 0x00, 0x00))
      expect(ev.kind).toBe('pitchBend')
      if (ev.kind !== 'pitchBend') throw new Error('expected pitchBend')
      expect(ev.value14).toBe(0)
      expect(ev.normalized).toBeCloseTo(-1, 10)
    })

    it('combines LSB and MSB into a 14-bit value', () => {
      // MSB 0x41, LSB 0x00 -> (0x41 << 7) = 8320
      const ev = parseMidiMessage(u8(0xe0, 0x00, 0x41))
      if (ev.kind !== 'pitchBend') throw new Error('expected pitchBend')
      expect(ev.value14).toBe(8320)
      expect(ev.normalized).toBeGreaterThan(0)
    })
  })

  describe('system messages', () => {
    it('decodes timing clock', () => {
      expect(parseMidiMessage(u8(0xf8))).toEqual({ kind: 'clock' })
    })
    it('decodes start', () => {
      expect(parseMidiMessage(u8(0xfa))).toEqual({ kind: 'start' })
    })
    it('decodes stop', () => {
      expect(parseMidiMessage(u8(0xfc))).toEqual({ kind: 'stop' })
    })
    it('buckets other real-time (active sensing) as clock', () => {
      expect(parseMidiMessage(u8(0xfe))).toEqual({ kind: 'clock' })
    })
    it('ignores system common / SysEx', () => {
      expect(parseMidiMessage(u8(0xf0, 0x7e, 0x7f))).toEqual({ kind: 'ignored' })
    })
  })

  describe('defensive handling', () => {
    it('ignores empty input', () => {
      expect(parseMidiMessage(u8())).toEqual({ kind: 'ignored' })
      expect(parseMidiMessage(null)).toEqual({ kind: 'ignored' })
      expect(parseMidiMessage(undefined)).toEqual({ kind: 'ignored' })
    })

    it('ignores a buffer beginning with a data byte (running-status fragment)', () => {
      expect(parseMidiMessage(u8(60, 100))).toEqual({ kind: 'ignored' })
    })

    it('masks data bytes with 0x7f so a stray high bit cannot escape range', () => {
      // 0xFF in a data slot would be 255; masked it is 127.
      const ev = parseMidiMessage(u8(0x90, 0xff, 0xff))
      if (ev.kind !== 'noteOn') throw new Error('expected noteOn')
      expect(ev.note).toBe(127)
      expect(ev.velocity).toBe(127)
    })

    it('treats a missing velocity byte as 0 -> Note Off', () => {
      expect(parseMidiMessage(u8(0x90, 60))).toEqual({
        kind: 'noteOff',
        channel: 1,
        note: 60,
      })
    })

    it('ignores aftertouch / program change', () => {
      expect(parseMidiMessage(u8(0xa0, 60, 64))).toEqual({ kind: 'ignored' }) // poly AT
      expect(parseMidiMessage(u8(0xc0, 5))).toEqual({ kind: 'ignored' }) // program change
      expect(parseMidiMessage(u8(0xd0, 64))).toEqual({ kind: 'ignored' }) // channel AT
    })
  })
})
