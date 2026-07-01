/**
 * PlayBar — the performance status + transport rail. Shows live/overload state
 * (with text + icon, never color alone), a panic button, and the per-performance
 * controls: octave, velocity-feel is handled by the keyboard, scale-lock,
 * polyphony. Octave/scale/polyphony edit the patch; panic releases everything.
 */
import { SCALE_DEGREES, type ScaleId } from '../audio/contracts'
import { Select } from './Select'

export interface PlayBarProps {
  audioStarted: boolean
  activeVoices: number
  overloaded: boolean
  octave: number
  scale: ScaleId
  polyphony: number
  onOctave: (v: number) => void
  onScale: (s: ScaleId) => void
  onPolyphony: (v: number) => void
  onPanic: () => void
}

const SCALE_LABELS: Record<ScaleId, string> = {
  chromatic: 'Chromatic',
  major: 'Major',
  minor: 'Minor',
  pentatonic: 'Pentatonic',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
}

export function PlayBar({
  audioStarted,
  activeVoices,
  overloaded,
  octave,
  scale,
  polyphony,
  onOctave,
  onScale,
  onPolyphony,
  onPanic,
}: PlayBarProps) {
  const playing = activeVoices > 0
  return (
    <section className="panel playbar" aria-labelledby="playbar-heading">
      <h2 id="playbar-heading" className="visually-hidden">
        Performance controls
      </h2>

      <div className="playbar__status" role="status" aria-live="polite">
        <span className="state-pill" data-state={audioStarted ? (playing ? 'playing' : 'live') : 'idle'}>
          <span className="state-pill__dot" aria-hidden="true" />
          {!audioStarted ? 'Idle' : playing ? `Playing · ${activeVoices}` : 'Live'}
        </span>
        {overloaded ? (
          <span className="state-pill state-pill--warn">
            <span aria-hidden="true">▲</span> Overload
          </span>
        ) : null}
      </div>

      <div className="playbar__controls">
        <label className="field field--inline">
          <span className="field__label">Octave</span>
          <span className="stepper">
            <button type="button" className="icon-button" aria-label="Octave down" onClick={() => onOctave(octave - 1)}>
              −
            </button>
            <span className="stepper__value" aria-live="off">
              {octave > 0 ? `+${octave}` : octave}
            </span>
            <button type="button" className="icon-button" aria-label="Octave up" onClick={() => onOctave(octave + 1)}>
              +
            </button>
          </span>
        </label>

        <label className="field field--inline" title="Snap played notes to this scale, so every key stays in key">
          <span className="field__label">Scale lock</span>
          <Select
            ariaLabel="Scale lock"
            value={scale}
            onChange={(v) => onScale(v as ScaleId)}
            options={(Object.keys(SCALE_DEGREES) as ScaleId[]).map((s) => ({ value: s, label: SCALE_LABELS[s] }))}
          />
        </label>

        <label className="field field--inline">
          <span className="field__label">Voices {polyphony}</span>
          <input
            type="range"
            className="slider"
            min={1}
            max={8}
            step={1}
            value={polyphony}
            onChange={(e) => onPolyphony(Number(e.target.value))}
            aria-label="Polyphony, maximum simultaneous voices"
            aria-valuetext={`${polyphony} voices`}
          />
        </label>

        <button
          type="button"
          className="button button--danger"
          title="Silence everything now — release all held voices"
          onClick={onPanic}
          disabled={!audioStarted}
        >
          Panic
        </button>
      </div>
    </section>
  )
}
