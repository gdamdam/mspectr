/**
 * MorphControl — the signature element. A horizontal "diffraction" slider that
 * slides spectral energy from snapshot A to snapshot B. Its track carries the
 * cyan→violet→magenta spectrum so the morph reads as physically moving light
 * between two captured identities.
 *
 * Built on a native range input for full keyboard + AT support; the visual is
 * layered on top. The endpoints are labelled with the slot labels (text, not
 * color alone).
 */
import type { ChangeEvent } from 'react'

export interface MorphControlProps {
  value: number
  onChange: (v: number) => void
  labelA: string
  labelB: string
  reducedIntensity: boolean
}

export function MorphControl({ value, onChange, labelA, labelB, reducedIntensity }: MorphControlProps) {
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))
  const pct = Math.round(value * 100)
  return (
    <div className="morph" data-dim={reducedIntensity || undefined}>
      <div className="morph__labels">
        <span className="morph__end" data-side="a">
          A · {labelA}
        </span>
        <span className="morph__readout" aria-hidden="true">
          {pct < 50 ? `A ${100 - pct}%` : pct > 50 ? `B ${pct}%` : 'A · B'}
        </span>
        <span className="morph__end" data-side="b">
          {labelB} · B
        </span>
      </div>
      <div className="morph__track">
        <input
          type="range"
          className="morph__range"
          min={0}
          max={1}
          step={0.001}
          value={value}
          onChange={onInput}
          aria-label={`Morph between snapshot A (${labelA}) and snapshot B (${labelB})`}
          aria-valuetext={`${pct} percent toward B`}
        />
        <span className="morph__fill" style={{ width: `${pct}%` }} aria-hidden="true" />
      </div>
    </div>
  )
}
