/**
 * SettingsModal — global preferences: quality mode, reduced motion, reduced
 * visual intensity, and live monitoring of generated sources. All persisted via
 * the App. Monitoring only affects generated sources (mic/tab stay muted for
 * feedback safety) — the copy says so.
 */
import type { QualityMode } from '../audio/contracts'
import type { Preferences } from '../app/state'
import { Modal } from './Modal'

export interface SettingsModalProps {
  prefs: Preferences
  quality: QualityMode
  onClose: () => void
  onPref: (key: keyof Preferences, value: boolean) => void
  onQuality: (q: QualityMode) => void
}

const QUALITIES: QualityMode[] = ['eco', 'normal', 'high']

export function SettingsModal({ prefs, quality, onClose, onPref, onQuality }: SettingsModalProps) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <fieldset className="advanced__group">
          <legend>Engine quality</legend>
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
        </fieldset>

        <label className="switch switch--row">
          <input
            type="checkbox"
            checked={prefs.reducedMotion}
            onChange={(e) => onPref('reducedMotion', e.target.checked)}
          />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__label">Reduced motion</span>
        </label>

        <label className="switch switch--row">
          <input
            type="checkbox"
            checked={prefs.reducedIntensity}
            onChange={(e) => onPref('reducedIntensity', e.target.checked)}
          />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__label">Reduced visual intensity</span>
        </label>

        <label className="switch switch--row">
          <input type="checkbox" checked={prefs.monitor} onChange={(e) => onPref('monitor', e.target.checked)} />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__label">Monitor generated sources</span>
        </label>
        <p className="muted">Microphone and tab audio never monitor through the output, to avoid feedback.</p>
      </div>
    </Modal>
  )
}
