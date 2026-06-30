/**
 * ShareModal — generate a shareable link.
 *
 * Two link kinds:
 *  - Patch link: always available, encodes the performance state only.
 *  - Embedded-snapshot link: also embeds the A/B spectral captures. This is
 *    gated three ways:
 *      1. Size — estimated bytes shown; blocked above MAX_SNAPSHOT_LINK_BYTES.
 *      2. Consent — if either embedded snapshot is live-derived (mic/tab), the
 *         user must explicitly confirm sharing derived data from their input.
 *  The link is built only after those gates pass.
 */
import { useMemo, useState } from 'react'
import {
  encodePatchLink,
  encodeSnapshotLink,
  estimateSnapshotLinkBytes,
  MAX_SNAPSHOT_LINK_BYTES,
} from '../sharing/patchLink'
import type { SpectralPatch, SpectralSnapshot } from '../audio/contracts'
import { Modal } from './Modal'

export interface ShareModalProps {
  patch: SpectralPatch
  snapshotA: SpectralSnapshot | null
  snapshotB: SpectralSnapshot | null
  /** True if either embedded snapshot is live-derived (consent gate). */
  hasLiveDerived: boolean
  /** Base URL to prefix the fragment with (defaults to current location). */
  baseUrl?: string
  onClose: () => void
}

function buildUrl(base: string, fragment: string): string {
  const clean = base.split('#')[0]
  return `${clean}#${fragment}`
}

export function ShareModal({
  patch,
  snapshotA,
  snapshotB,
  hasLiveDerived,
  baseUrl,
  onClose,
}: ShareModalProps) {
  const [embed, setEmbed] = useState(false)
  const [consent, setConsent] = useState(false)
  const [copied, setCopied] = useState(false)

  const hasSnapshots = Boolean(snapshotA || snapshotB)
  const base = baseUrl ?? (typeof location !== 'undefined' ? location.href : '')

  const estimatedBytes = useMemo(
    () => (hasSnapshots ? estimateSnapshotLinkBytes(patch, snapshotA, snapshotB) : 0),
    [patch, snapshotA, snapshotB, hasSnapshots],
  )
  const oversized = embed && estimatedBytes > MAX_SNAPSHOT_LINK_BYTES
  const consentNeeded = embed && hasLiveDerived && !consent
  const blocked = embed && (oversized || consentNeeded)

  const link = useMemo(() => {
    if (!embed) return buildUrl(base, encodePatchLink(patch))
    if (blocked) return ''
    return buildUrl(base, encodeSnapshotLink(patch, snapshotA, snapshotB))
  }, [embed, blocked, base, patch, snapshotA, snapshotB])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal
      title="Share"
      onClose={onClose}
      description="Patch links carry only the performance state. Embedding snapshots includes the captured spectra."
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
          <button type="button" className="button button--primary" onClick={copy} disabled={!link}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </>
      }
    >
      <div className="share">
        <label className="switch switch--row">
          <input
            type="checkbox"
            checked={embed}
            disabled={!hasSnapshots}
            onChange={(e) => setEmbed(e.target.checked)}
          />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__label">Embed snapshots {hasSnapshots ? '' : '(none captured)'}</span>
        </label>

        {embed ? (
          <p className="share__size" data-over={oversized || undefined}>
            Approx. size: <strong>{(estimatedBytes / 1000).toFixed(1)} KB</strong> of{' '}
            {(MAX_SNAPSHOT_LINK_BYTES / 1000).toFixed(0)} KB limit
          </p>
        ) : null}

        {oversized ? (
          <p className="share__error" role="alert">
            These snapshots are too large to embed in a link. Share as a patch link, or save the session and export
            JSON instead.
          </p>
        ) : null}

        {embed && hasLiveDerived ? (
          <label className="switch switch--row share__consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="switch__track" aria-hidden="true" />
            <span className="switch__label">
              I consent to sharing spectral data derived from my microphone or tab audio.
            </span>
          </label>
        ) : null}

        <label className="field">
          <span className="field__label">Link</span>
          <input
            type="text"
            className="input"
            readOnly
            value={link}
            placeholder={blocked ? 'Resolve the warnings above to generate the link' : ''}
            aria-label="Shareable link"
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      </div>
    </Modal>
  )
}
