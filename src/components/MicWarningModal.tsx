/**
 * MicWarningModal — a feedback-safety gate shown before enabling the microphone.
 * Live input is never monitored through the output, but capturing while
 * speakers are live can still cause a feedback loop into the analysis, so we
 * recommend headphones once, explicitly, before granting mic access.
 */
import { Modal } from './Modal'

export interface MicWarningModalProps {
  onClose: () => void
  onConfirm: () => void
}

export function MicWarningModal({ onClose, onConfirm }: MicWarningModalProps) {
  return (
    <Modal
      title="Use headphones"
      onClose={onClose}
      description="The microphone feeds the analyser. With open speakers this can create a feedback loop."
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm}>
            Enable microphone
          </button>
        </>
      }
    >
      <p className="muted">
        Microphone and tab audio are never played back through the output. Wear headphones and keep input levels
        moderate.
      </p>
    </Modal>
  )
}
