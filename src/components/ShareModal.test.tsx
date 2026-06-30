// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ShareModal } from './ShareModal'
import { DEFAULT_PATCH, MAX_FFT_SIZE, type SpectralSnapshot } from '../audio/contracts'
import { estimateSnapshotLinkBytes, MAX_SNAPSHOT_LINK_BYTES } from '../sharing/patchLink'

function makeSnapshot(opts: { fftSize?: number; live?: boolean; withPhase?: boolean } = {}): SpectralSnapshot {
  const fftSize = opts.fftSize ?? 2048
  const binCount = fftSize / 2 + 1
  const magnitude = new Float32Array(binCount)
  for (let i = 0; i < binCount; i++) magnitude[i] = Math.random()
  const phase = opts.withPhase ? new Float32Array(binCount).map(() => Math.random() * 6.28 - 3.14) : null
  return {
    schemaVersion: 1,
    fftSize,
    binCount,
    analysisSampleRate: 48000,
    baseFrequency: 220,
    magnitude,
    phase,
    sourceLabel: opts.live ? 'Microphone' : 'Glass Memory',
    capturedAt: 1000,
    isLiveDerived: Boolean(opts.live),
  }
}

beforeEach(() => {
  cleanup()
  // jsdom has no clipboard by default.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('ShareModal', () => {
  it('produces a patch link by default (no embed)', () => {
    render(
      <ShareModal
        patch={DEFAULT_PATCH}
        snapshotA={makeSnapshot()}
        snapshotB={null}
        hasLiveDerived={false}
        baseUrl="https://mspectr.test/"
        onClose={() => {}}
      />,
    )
    const link = screen.getByLabelText('Shareable link') as HTMLInputElement
    expect(link.value).toMatch(/^https:\/\/mspectr\.test\/#.+/)
  })

  it('shows the estimated size when embedding snapshots', () => {
    const a = makeSnapshot()
    render(
      <ShareModal
        patch={DEFAULT_PATCH}
        snapshotA={a}
        snapshotB={null}
        hasLiveDerived={false}
        baseUrl="https://mspectr.test/"
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Embed snapshots/i))
    // Size readout appears and reflects the real estimate (in KB).
    const kb = (estimateSnapshotLinkBytes(DEFAULT_PATCH, a, null) / 1000).toFixed(1)
    expect(screen.getByText(new RegExp(`${kb}\\s*KB`))).toBeInTheDocument()
  })

  it('blocks an oversized embedded-snapshot link', () => {
    // Two max-FFT snapshots with phase exceed MAX_SNAPSHOT_LINK_BYTES.
    const a = makeSnapshot({ fftSize: MAX_FFT_SIZE, withPhase: true })
    const b = makeSnapshot({ fftSize: MAX_FFT_SIZE, withPhase: true })
    expect(estimateSnapshotLinkBytes(DEFAULT_PATCH, a, b)).toBeGreaterThan(MAX_SNAPSHOT_LINK_BYTES)
    render(
      <ShareModal
        patch={DEFAULT_PATCH}
        snapshotA={a}
        snapshotB={b}
        hasLiveDerived={false}
        baseUrl="https://mspectr.test/"
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Embed snapshots/i))
    expect(screen.getByRole('alert')).toHaveTextContent(/too large/i)
    const link = screen.getByLabelText('Shareable link') as HTMLInputElement
    expect(link.value).toBe('') // no link produced while blocked
  })

  it('requires explicit consent before embedding live-derived data', () => {
    const a = makeSnapshot({ live: true })
    render(
      <ShareModal
        patch={DEFAULT_PATCH}
        snapshotA={a}
        snapshotB={null}
        hasLiveDerived={true}
        baseUrl="https://mspectr.test/"
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Embed snapshots/i))
    const link = () => screen.getByLabelText('Shareable link') as HTMLInputElement
    // Blocked until consent is given.
    expect(link().value).toBe('')
    const consent = screen.getByLabelText(/consent to sharing spectral data/i)
    fireEvent.click(consent)
    expect(link().value).toMatch(/^https:\/\/mspectr\.test\/#.+/)
  })
})
