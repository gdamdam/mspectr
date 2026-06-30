/**
 * CapturePanel — turning the live spectrum into held identities. Capture into A
 * or B (single frame or short average), freeze/clear the live spectrum, and the
 * slot operations swap / copy A→B. Disabled until audio has started.
 */
import type { CaptureMode, SnapshotSlot } from '../audio/contracts'

export interface CapturePanelProps {
  audioStarted: boolean
  liveFrozen: boolean
  captureMode: CaptureMode
  onCaptureModeChange: (mode: CaptureMode) => void
  onCapture: (slot: SnapshotSlot, mode: CaptureMode) => void
  onFreeze: (on: boolean) => void
  onClearLive: () => void
  onSwap: () => void
  onCopy: (from: SnapshotSlot, to: SnapshotSlot) => void
}

export function CapturePanel({
  audioStarted,
  liveFrozen,
  captureMode,
  onCaptureModeChange,
  onCapture,
  onFreeze,
  onClearLive,
  onSwap,
  onCopy,
}: CapturePanelProps) {
  const disabled = !audioStarted
  return (
    <section className="panel capture" aria-labelledby="capture-heading">
      <h2 id="capture-heading" className="panel__eyebrow">
        Capture
      </h2>

      <fieldset className="capture__mode" disabled={disabled}>
        <legend className="visually-hidden">Capture mode</legend>
        <label className="radio">
          <input
            type="radio"
            name="capture-mode"
            checked={captureMode === 'frame'}
            onChange={() => onCaptureModeChange('frame')}
          />
          <span>Frame</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="capture-mode"
            checked={captureMode === 'average'}
            onChange={() => onCaptureModeChange('average')}
          />
          <span>Average</span>
        </label>
      </fieldset>

      <div className="capture__buttons">
        <button type="button" className="button" disabled={disabled} onClick={() => onCapture('A', captureMode)}>
          Capture → A
        </button>
        <button type="button" className="button" disabled={disabled} onClick={() => onCapture('B', captureMode)}>
          Capture → B
        </button>
      </div>

      <div className="capture__live">
        <button
          type="button"
          className="button"
          aria-pressed={liveFrozen}
          disabled={disabled}
          onClick={() => onFreeze(!liveFrozen)}
        >
          {liveFrozen ? 'Unfreeze' : 'Freeze'} live
        </button>
        <button type="button" className="button" disabled={disabled} onClick={onClearLive}>
          Clear live
        </button>
      </div>

      <div className="capture__slots">
        <button type="button" className="chip" disabled={disabled} onClick={onSwap}>
          Swap A ⇄ B
        </button>
        <button type="button" className="chip" disabled={disabled} onClick={() => onCopy('A', 'B')}>
          Copy A → B
        </button>
      </div>
    </section>
  )
}
