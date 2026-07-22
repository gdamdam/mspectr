/**
 * CapturePanel — turning the live spectrum into held identities. Capture into A
 * or B (single frame, short average, or a "living" multi-frame capture that
 * replays the sound's movement), freeze/clear the live spectrum, and the slot
 * operations swap / copy A→B. Disabled until audio has started.
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
        <label className="radio" title="Grab one instant of the spectrum — a single still frame">
          <input
            type="radio"
            name="capture-mode"
            checked={captureMode === 'frame'}
            onChange={() => onCaptureModeChange('frame')}
          />
          <span>Single</span>
        </label>
        <label className="radio" title="Average several frames into one steady, smoothed spectrum">
          <input
            type="radio"
            name="capture-mode"
            checked={captureMode === 'average'}
            onChange={() => onCaptureModeChange('average')}
          />
          <span>Average</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="capture-mode"
            checked={captureMode === 'evolving'}
            onChange={() => onCaptureModeChange('evolving')}
            aria-describedby="capture-mode-living-hint"
          />
          <span>Living</span>
        </label>
      </fieldset>
      <p id="capture-mode-living-hint" className="capture__hint muted">
        Living captures the sound&rsquo;s movement — attack, body, decay.
      </p>

      <div className="capture__buttons">
        <button
          type="button"
          className="button"
          disabled={disabled}
          title="Store the live spectrum into slot A as a playable snapshot"
          onClick={() => onCapture('A', captureMode)}
        >
          Capture → A
        </button>
        <button
          type="button"
          className="button"
          disabled={disabled}
          title="Store the live spectrum into slot B as a playable snapshot"
          onClick={() => onCapture('B', captureMode)}
        >
          Capture → B
        </button>
      </div>
      <p className="capture__hint muted">
        Presets preselect a capture mode — capturing is always a manual press.
      </p>

      <div className="capture__live">
        <button
          type="button"
          className="button"
          aria-pressed={liveFrozen}
          disabled={disabled}
          title="Hold the live spectrum still so it stops following the input"
          onClick={() => onFreeze(!liveFrozen)}
        >
          {liveFrozen ? 'Unfreeze' : 'Freeze'} live
        </button>
        <button
          type="button"
          className="button"
          disabled={disabled}
          title="Discard the live spectrum and start listening fresh"
          onClick={onClearLive}
        >
          Clear live
        </button>
      </div>

      <div className="capture__slots">
        <button
          type="button"
          className="chip"
          disabled={disabled}
          title="Exchange the snapshots in slots A and B"
          onClick={onSwap}
        >
          Swap A ⇄ B
        </button>
        <button
          type="button"
          className="chip"
          disabled={disabled}
          title="Duplicate slot A into slot B"
          onClick={() => onCopy('A', 'B')}
        >
          Copy A → B
        </button>
      </div>
    </section>
  )
}
