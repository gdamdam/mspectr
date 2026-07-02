/**
 * AdvancedPanel — the collapsible technical surface. Exposes the raw
 * SpectralParams (shift/formant/blur/tilt/gate/harmony/phase-motion/envelope/
 * space/gains), the quality mode (ECO/NORMAL/HIGH), and the deterministic seed.
 * Hidden by default behind a disclosure so the permanent UI stays minimal.
 *
 * Field definitions are data-driven so the panel stays exhaustive without a wall
 * of near-identical JSX. Discrete params (interval set, phase mode, quality) get
 * dedicated selects.
 */
import {
  INTERVAL_SETS,
  MAX_HARMONY_VOICES,
  type IntervalSetId,
  type PhaseMode,
  type QualityMode,
  type SpectralParams,
} from '../audio/contracts'
import { Select } from './Select'
import { useState } from 'react'

export interface AdvancedPanelProps {
  open: boolean
  onToggle: () => void
  params: SpectralParams
  quality: QualityMode
  seed: number
  onParam: <K extends keyof SpectralParams>(key: K, value: SpectralParams[K]) => void
  onQuality: (q: QualityMode) => void
  onSeed: (seed: number) => void
}

interface NumField {
  key: keyof SpectralParams
  label: string
  min: number
  max: number
  step: number
  unit?: string
}

// Grouped, exhaustive numeric params. Discrete ones handled separately below.
const GROUPS: { title: string; fields: NumField[] }[] = [
  {
    title: 'Spectrum',
    fields: [
      { key: 'shift', label: 'Shift', min: -24, max: 24, step: 0.1, unit: 'st' },
      { key: 'formant', label: 'Formant', min: -24, max: 24, step: 0.1, unit: 'st' },
      { key: 'blur', label: 'Blur', min: 0, max: 1, step: 0.01 },
      { key: 'tilt', label: 'Tilt', min: -1, max: 1, step: 0.01 },
      { key: 'gate', label: 'Gate', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Harmony',
    fields: [
      { key: 'harmonyVoices', label: 'Voices', min: 0, max: MAX_HARMONY_VOICES, step: 1 },
      { key: 'harmonyMix', label: 'Mix', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Motion',
    fields: [{ key: 'phaseMotion', label: 'Phase motion', min: 0, max: 1, step: 0.01 }],
  },
  {
    // Multi-frame ("flipbook") replay of an evolving snapshot. No effect on
    // static (single-frame) captures.
    title: 'Flipbook',
    fields: [
      { key: 'frameSpeed', label: 'Speed', min: -2, max: 2, step: 0.01, unit: '×' },
      { key: 'framePosition', label: 'Position', min: 0, max: 1, step: 0.01 },
      { key: 'frameLoopStart', label: 'Loop start', min: 0, max: 1, step: 0.01 },
      { key: 'frameLoopEnd', label: 'Loop end', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Envelope',
    fields: [
      { key: 'attack', label: 'Attack', min: 0, max: 10, step: 0.01, unit: 's' },
      { key: 'decay', label: 'Decay', min: 0, max: 10, step: 0.01, unit: 's' },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01 },
      { key: 'release', label: 'Release', min: 0.001, max: 20, step: 0.01, unit: 's' },
    ],
  },
  {
    title: 'Pitch',
    fields: [
      { key: 'transpose', label: 'Transpose', min: -24, max: 24, step: 1, unit: 'st' },
      { key: 'bendRange', label: 'Bend range', min: 0, max: 24, step: 1, unit: 'st' },
    ],
  },
  {
    title: 'Space',
    fields: [
      { key: 'stereoWidth', label: 'Width', min: 0, max: 1, step: 0.01 },
      { key: 'earlyReflections', label: 'Early reflections', min: 0, max: 1, step: 0.01 },
      { key: 'reverbAmount', label: 'Reverb', min: 0, max: 1, step: 0.01 },
      { key: 'diffusion', label: 'Diffusion', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Gains',
    fields: [
      { key: 'inputGainDb', label: 'Input gain', min: -24, max: 24, step: 0.5, unit: 'dB' },
      { key: 'outputGainDb', label: 'Output gain', min: -24, max: 24, step: 0.5, unit: 'dB' },
    ],
  },
]

const QUALITIES: QualityMode[] = ['eco', 'normal', 'high']

function SeedInput({ seed, onSeed }: { seed: number; onSeed: (seed: number) => void }) {
  const [draft, setDraft] = useState(String(seed))
  const commit = () => {
    const value = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(value)) {
      setDraft(String(seed))
      return
    }
    const next = Math.max(0, Math.min(0xffffffff, Math.round(value)))
    setDraft(String(next))
    onSeed(next)
  }
  return (
    <input
      type="number"
      className="input"
      min={0}
      max={0xffffffff}
      step={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(String(seed))
          e.currentTarget.blur()
        }
      }}
      aria-label="Deterministic seed"
    />
  )
}

export function AdvancedPanel({
  open,
  onToggle,
  params,
  quality,
  seed,
  onParam,
  onQuality,
  onSeed,
}: AdvancedPanelProps) {
  return (
    <section className="panel advanced" aria-labelledby="advanced-heading">
      <button
        type="button"
        id="advanced-heading"
        className="disclosure"
        aria-expanded={open}
        aria-controls="advanced-body"
        onClick={onToggle}
      >
        <span className="disclosure__caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        Advanced parameters
      </button>

      {open ? (
        <div id="advanced-body" className="advanced__body">
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="advanced__group">
              <legend>{group.title}</legend>
              {group.fields.map((f) => {
                const value = params[f.key] as number
                return (
                  <label key={String(f.key)} className="param">
                    <span className="param__label">
                      {f.label}
                      <span className="param__value">
                        {f.step >= 1 ? value : value.toFixed(2)}
                        {f.unit ? ` ${f.unit}` : ''}
                      </span>
                    </span>
                    <input
                      type="range"
                      className="slider"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={value}
                      onChange={(e) => onParam(f.key, Number(e.target.value) as SpectralParams[typeof f.key])}
                      aria-label={f.label}
                      aria-valuetext={`${value}${f.unit ? ` ${f.unit}` : ''}`}
                    />
                  </label>
                )
              })}
            </fieldset>
          ))}

          <fieldset className="advanced__group">
            <legend>Harmony interval</legend>
            <label className="field">
              <span className="visually-hidden">Harmony interval set</span>
              <Select
                ariaLabel="Harmony interval set"
                value={params.harmonyInterval}
                onChange={(v) => onParam('harmonyInterval', v as IntervalSetId)}
                options={(Object.keys(INTERVAL_SETS) as IntervalSetId[]).map((id) => ({ value: id, label: id }))}
              />
            </label>
            <label className="field">
              <span className="field__label">Freeze phase</span>
              <Select
                ariaLabel="Freeze phase"
                value={params.freezePhase}
                onChange={(v) => onParam('freezePhase', v as PhaseMode)}
                options={[
                  { value: 'animate', label: 'Animate' },
                  { value: 'lock', label: 'Lock' },
                ]}
              />
            </label>
          </fieldset>

          <fieldset className="advanced__group">
            <legend>Engine</legend>
            <div className="seg" role="radiogroup" aria-label="Quality mode">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={quality === q}
                  className="seg__option"
                  onClick={() => onQuality(q)}
                >
                  {q.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field__label">Seed</span>
              <SeedInput key={seed} seed={seed} onSeed={onSeed} />
            </label>
          </fieldset>
        </div>
      ) : null}
    </section>
  )
}
