/**
 * HelpModal — a short orientation. mspectr is unusual enough that a few honest
 * sentences save a lot of confusion: capture a sound's spectrum, then play what
 * it is made of, morphing between two captured identities.
 */
import { Modal } from './Modal'

export interface HelpModalProps {
  onClose: () => void
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <Modal title="How mspectr works" onClose={onClose}>
      <div className="help">
        <ol className="help__steps">
          <li>
            <strong>Pick a source.</strong> Start with a preset, or feed it a file, your microphone, or a browser
            tab. The live spectrum plays the moment audio starts.
          </li>
          <li>
            <strong>Capture an identity.</strong> Freeze a single frame or a short average into slot A or B. Each slot
            holds the spectral fingerprint of a sound — not the recording.
          </li>
          <li>
            <strong>Morph and play.</strong> The large A↔B control slides between your two captures. Play with the
            computer keyboard or MIDI; the four macros reshape body, motion, harmony, and space.
          </li>
        </ol>
        <p className="muted">
          Captures from a microphone or tab are marked <em>live-derived</em>. Sharing them in a link asks for explicit
          consent first.
        </p>
        <p className="help__version">mspectr v{__APP_VERSION__}</p>
      </div>
    </Modal>
  )
}
