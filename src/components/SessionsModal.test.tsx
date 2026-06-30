// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { SavedInstrument } from '../audio/contracts'
import { DEFAULT_PATCH } from '../audio/contracts'

// Mock the persistence layer (IndexedDB is unavailable in jsdom).
const deleteInstrument = vi.fn().mockResolvedValue(undefined)
const listInstruments = vi.fn()
const renameInstrument = vi.fn().mockResolvedValue(undefined)
const duplicateInstrument = vi.fn().mockResolvedValue(null)

vi.mock('../persistence/instruments', () => ({
  deleteInstrument: (...a: unknown[]) => deleteInstrument(...a),
  listInstruments: () => listInstruments(),
  renameInstrument: (...a: unknown[]) => renameInstrument(...a),
  duplicateInstrument: (...a: unknown[]) => duplicateInstrument(...a),
}))

import { SessionsModal } from './SessionsModal'

const sample: SavedInstrument = {
  schemaVersion: 1,
  id: 'inst-1',
  name: 'Iron Bloom',
  createdAt: 1000,
  updatedAt: 2000,
  patch: DEFAULT_PATCH,
  snapshotRefA: null,
  snapshotRefB: null,
  sourceLabel: 'Iron Bloom',
}

const noop = () => Promise.resolve()

beforeEach(() => {
  cleanup()
  deleteInstrument.mockClear()
  listInstruments.mockReset().mockResolvedValue([sample])
})

describe('SessionsModal — delete confirmation', () => {
  it('does not delete on the first click; requires a confirm step', async () => {
    render(
      <SessionsModal
        currentName="Scene"
        onClose={() => {}}
        onSave={noop}
        onLoad={noop}
        onExport={noop}
        onImport={noop}
      />,
    )
    // Wait for the list to load.
    await screen.findByText('Iron Bloom')

    // First click reveals the confirm control but does NOT delete.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteInstrument).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()

    // Confirm actually deletes.
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => expect(deleteInstrument).toHaveBeenCalledWith('inst-1'))
  })

  it('cancelling the confirm step aborts the delete', async () => {
    render(
      <SessionsModal
        currentName="Scene"
        onClose={() => {}}
        onSave={noop}
        onLoad={noop}
        onExport={noop}
        onImport={noop}
      />,
    )
    await screen.findByText('Iron Bloom')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleteInstrument).not.toHaveBeenCalled()
    // The plain Delete button is back.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('surfaces a storage error instead of crashing', async () => {
    listInstruments.mockRejectedValueOnce(new Error('no idb'))
    render(
      <SessionsModal
        currentName="Scene"
        onClose={() => {}}
        onSave={noop}
        onLoad={noop}
        onExport={noop}
        onImport={noop}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i)
  })
})
