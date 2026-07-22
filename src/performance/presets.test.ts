import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset } from './presets'
import { resolveParams } from './macros'
import { renderGeneratedBuffer } from '../sources/generated'
import {
  sanitizePatch,
  GENERATED_SOURCE_IDS,
  SCALE_DEGREES,
  PRESET_SCHEMA_VERSION,
  MAX_HARMONY_VOICES,
} from '../audio/contracts'
import type { CaptureMode, ScaleId, GeneratedSourceId } from '../audio/contracts'


const VALID_SCALES = Object.keys(SCALE_DEGREES) as ScaleId[]
const VALID_CAPTURE: CaptureMode[] = ['frame', 'average', 'evolving']

describe('PRESETS library', () => {
  it('contains at least 20 presets, all named with unique names', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(20)
    const names = PRESETS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset has a one-line hint and a group', () => {
    for (const p of PRESETS) {
      expect(p.hint.length).toBeGreaterThan(0)
      expect(p.hint).not.toContain('\n')
      expect(p.group.length).toBeGreaterThan(0)
    }
  })

  it('references a valid generated source id', () => {
    for (const p of PRESETS) {
      expect(GENERATED_SOURCE_IDS).toContain<GeneratedSourceId>(p.source)
    }
  })

  it('uses a valid scale and capture strategy', () => {
    for (const p of PRESETS) {
      expect(VALID_SCALES).toContain<ScaleId>(p.patch.scale)
      expect(VALID_CAPTURE).toContain<CaptureMode>(p.captureStrategy)
    }
  })

  it('has a modest calibration trim (within ±6 dB)', () => {
    for (const p of PRESETS) {
      expect(Number.isFinite(p.calibrationDb)).toBe(true)
      expect(Math.abs(p.calibrationDb)).toBeLessThanOrEqual(6)
    }
  })

  it('declares the current preset schema version on each patch', () => {
    for (const p of PRESETS) {
      expect(p.patch.schemaVersion).toBe(PRESET_SCHEMA_VERSION)
      // presetId should match the preset id for a coherent round-trip.
      expect(p.patch.presetId).toBe(p.id)
    }
  })

  it('covers every one of the 14 generated sources', () => {
    const used = new Set(PRESETS.map((p) => p.source))
    for (const src of used) expect(GENERATED_SOURCE_IDS).toContain(src)
    // Each available generator must anchor at least one preset so its character
    // is actually reachable through the factory library — not left dormant.
    const unused = GENERATED_SOURCE_IDS.filter((id) => !used.has(id))
    expect(unused, `generated sources never used by any preset: ${unused.join(', ') || '(none)'}`).toEqual([])
    expect(used.size).toBe(GENERATED_SOURCE_IDS.length)
  })
})

describe('preset patches round-trip through sanitizePatch unchanged', () => {
  it('sanitizePatch(patch) deep-equals the authored patch', () => {
    for (const p of PRESETS) {
      const sanitized = sanitizePatch(p.patch)
      expect(sanitized, `preset "${p.id}" must sanitize unchanged`).toEqual(p.patch)
    }
  })

  it('XY mapping axes use valid params and ordered/finite ranges', () => {
    for (const p of PRESETS) {
      for (const axis of [p.xyMapping.x, p.xyMapping.y]) {
        expect(typeof axis.param).toBe('string')
        expect(Number.isFinite(axis.min)).toBe(true)
        expect(Number.isFinite(axis.max)).toBe(true)
        expect(axis.max).toBeGreaterThanOrEqual(axis.min)
      }
    }
  })
})

describe('presets resolve to valid worklet params', () => {
  it('resolveParams over each preset stays finite & in range', () => {
    for (const p of PRESETS) {
      const out = resolveParams(p.patch, p.xyMapping)
      expect(Number.isFinite(out.shift)).toBe(true)
      expect(out.blur).toBeGreaterThanOrEqual(0)
      expect(out.blur).toBeLessThanOrEqual(1)
      expect(out.harmonyVoices).toBeGreaterThanOrEqual(0)
      expect(out.harmonyVoices).toBeLessThanOrEqual(MAX_HARMONY_VOICES)
      expect(Number.isInteger(out.harmonyVoices)).toBe(true)
      expect(out.stereoWidth).toBeGreaterThanOrEqual(0)
      expect(out.stereoWidth).toBeLessThanOrEqual(1)
    }
  })
})

describe('getPreset', () => {
  it('returns the matching preset by id', () => {
    const p = getPreset('glass-memory')
    expect(p).toBeDefined()
    expect(p?.name).toBe('Glass Memory')
  })

  it('finds every authored id', () => {
    for (const preset of PRESETS) {
      expect(getPreset(preset.id)).toBe(preset)
    }
  })

  it('returns undefined for an unknown id', () => {
    expect(getPreset('does-not-exist')).toBeUndefined()
    expect(getPreset('')).toBeUndefined()
  })
})

describe('presets are musically distinct', () => {
  it('no two presets share an identical authored params signature', () => {
    const sigs = PRESETS.map((p) =>
      JSON.stringify([
        p.patch.params.freeze,
        p.patch.params.phaseMotion,
        p.patch.params.tilt,
        p.patch.params.formant,
        p.patch.params.blur,
        p.patch.params.harmonyInterval,
        p.patch.params.reverbAmount,
        p.patch.scale,
      ]),
    )
    expect(new Set(sigs).size).toBe(PRESETS.length)
  })

  // The authored-params check above is necessary but NOT sufficient: linked
  // macros (takeover) and the XY surface OVERWRITE some authored values, so two
  // presets with different authored params can still resolve to the same thing
  // the worklet actually hears. Compare the EFFECTIVE, fully-resolved params.
  it('no two presets share an identical EFFECTIVE (resolved) params signature', () => {
    // Full resolved SpectralParams + scale — everything that shapes the sound
    // after macros + XY are applied. Keys sorted so the JSON is stable.
    const sigOf = (p: (typeof PRESETS)[number]): string => {
      const resolved = resolveParams(p.patch, p.xyMapping)
      const ordered: Record<string, unknown> = {}
      for (const k of Object.keys(resolved).sort()) ordered[k] = (resolved as unknown as Record<string, unknown>)[k]
      return JSON.stringify({ ...ordered, scale: p.patch.scale })
    }
    const bySig = new Map<string, string[]>()
    for (const p of PRESETS) {
      const sig = sigOf(p)
      const list = bySig.get(sig)
      if (list) list.push(p.id)
      else bySig.set(sig, [p.id])
    }
    const collisions = Array.from(bySig.values()).filter((ids) => ids.length > 1)
    // Useful diagnostics: name the colliding preset groups, not just a count.
    expect(collisions, `presets with identical effective params: ${JSON.stringify(collisions)}`).toEqual([])
    expect(bySig.size).toBe(PRESETS.length)
  })

  // Flag presets that, while not byte-identical, resolve SUSPICIOUSLY close on the
  // continuous fields a listener notices most — so overly similar pairs surface as
  // a diagnostic even before they become exact duplicates.
  it('reports the closest effective-params pair for review (non-fatal above a floor)', () => {
    const FIELDS: (keyof SpectralParamsish)[] = ['tilt', 'formant', 'blur', 'phaseMotion', 'gate', 'shift', 'harmonyMix', 'reverbAmount', 'stereoWidth']
    const vecs = PRESETS.map((p) => {
      const r = resolveParams(p.patch, p.xyMapping) as unknown as Record<string, number>
      return { id: p.id, v: FIELDS.map((f) => r[f as string] ?? 0) }
    })
    let closest = { a: '', b: '', d: Infinity }
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        let sum = 0
        for (let k = 0; k < FIELDS.length; k++) {
          const d = vecs[i].v[k] - vecs[j].v[k]
          sum += d * d
        }
        const dist = Math.sqrt(sum)
        if (dist < closest.d) closest = { a: vecs[i].id, b: vecs[j].id, d: dist }
      }
    }
    // A generous floor: two distinct scenes should differ by more than a hair
    // across nine perceptual fields. This is deliberately loose (not perceptual
    // ground truth) — it only catches near-clones, and names the pair if it trips.
    expect(closest.d, `closest effective pair: ${closest.a} ↔ ${closest.b} (dist ${closest.d.toFixed(3)})`).toBeGreaterThan(0.1)
  })
})

// A tiny structural alias so the FIELDS list above stays type-checked against the
// real params shape without importing the full interface name here.
type SpectralParamsish = ReturnType<typeof resolveParams>

// ---------------------------------------------------------------------------
// Rendered-audio feature checks. Each preset is anchored to a generated source;
// verify those sources are ACOUSTICALLY diverse (not merely byte-distinct) using
// cheap, robust features — brightness (zero-crossing rate), tonality (normalized
// autocorrelation peak), and a transient/steady ratio (head vs. tail energy).
// Deliberately loose: no sample-perfect thresholds, only relative distinctness.
// ---------------------------------------------------------------------------

/** Minimal BaseAudioContext for node: renderGeneratedBuffer only needs these. */
function makeCtx(sampleRate = 48000): BaseAudioContext {
  return {
    sampleRate,
    createBuffer(channels: number, length: number, sr: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sr,
        getChannelData: (ch: number) => data[ch],
        copyToChannel: (src: Float32Array, ch: number) => data[ch].set(src),
      }
    },
  } as unknown as BaseAudioContext
}

/** Render a source's deterministic mono buffer at a short length for feature checks. */
function renderMono(id: (typeof PRESETS)[number]['source'], sampleRate: number, seconds: number): Float32Array {
  return renderGeneratedBuffer(makeCtx(sampleRate), id, seconds).getChannelData(0)
}

interface AudioFeatures {
  zcr: number
  tonality: number
  transientRatio: number
}

function features(data: Float32Array, sampleRate: number): AudioFeatures {
  const n = data.length
  // Zero-crossing rate → coarse brightness proxy.
  let crossings = 0
  for (let i = 1; i < n; i++) {
    if ((data[i - 1] <= 0 && data[i] > 0) || (data[i - 1] >= 0 && data[i] < 0)) crossings++
  }
  const zcr = crossings / n

  // Normalized autocorrelation peak over a musical lag range → tonality (high for
  // periodic/tonal sources, low for noisy ones).
  let energy = 0
  for (let i = 0; i < n; i++) energy += data[i] * data[i]
  let best = 0
  const minLag = Math.floor(sampleRate / 1000) // 1 kHz
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 60)) // 60 Hz
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let acc = 0
    for (let i = lag; i < n; i++) acc += data[i] * data[i - lag]
    const norm = acc / (energy || 1)
    if (norm > best) best = norm
  }
  const tonality = best

  // Head vs. tail RMS → transient/steady-state character.
  const seg = Math.max(1, Math.floor(n / 8))
  const rms = (start: number, len: number): number => {
    let s = 0
    for (let i = start; i < start + len && i < n; i++) s += data[i] * data[i]
    return Math.sqrt(s / len)
  }
  const head = rms(0, seg)
  const tail = rms(n - seg, seg)
  const transientRatio = head / (tail + 1e-9)

  return { zcr, tonality, transientRatio }
}

describe('preset sources are acoustically diverse (rendered features)', () => {
  const SR = 48000
  const SECONDS = 0.7 // short slice keeps the full pairwise sweep well under the timeout

  it('every source used by a preset renders finite, audible audio', () => {
    for (const id of new Set(PRESETS.map((p) => p.source))) {
      const data = renderMono(id, SR, SECONDS)
      let peak = 0
      let allFinite = true
      for (const s of data) {
        if (!Number.isFinite(s)) allFinite = false
        peak = Math.max(peak, Math.abs(s))
      }
      expect(allFinite, `${id} produced a non-finite sample`).toBe(true)
      expect(peak, `${id} rendered silence`).toBeGreaterThan(0.05)
    }
  })

  it('no two distinct sources have a near-identical feature signature', () => {
    const used = Array.from(new Set(PRESETS.map((p) => p.source)))
    const feat = new Map(used.map((id) => [id, features(renderMono(id, SR, SECONDS), SR)]))
    let closest = { a: '', b: '', d: Infinity }
    for (let i = 0; i < used.length; i++) {
      for (let j = i + 1; j < used.length; j++) {
        const fa = feat.get(used[i])!
        const fb = feat.get(used[j])!
        // Scale each feature to a comparable range before the distance.
        const d = Math.hypot(
          (fa.zcr - fb.zcr) * 20,
          (fa.tonality - fb.tonality) * 4,
          Math.min(2, Math.abs(fa.transientRatio - fb.transientRatio)),
        )
        if (d < closest.d) closest = { a: used[i], b: used[j], d }
      }
    }
    expect(closest.d, `closest source pair: ${closest.a} ↔ ${closest.b} (feature dist ${closest.d.toFixed(3)})`).toBeGreaterThan(0.05)
  })
})
