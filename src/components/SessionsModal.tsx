/**
 * SessionsModal — saved-instrument library. Save the current patch, load,
 * rename, duplicate, and delete (with an explicit confirm step), plus JSON
 * export/import. All persistence is async and may reject when IndexedDB is
 * unavailable; failures surface as an inline error rather than crashing.
 */
import { useEffect, useRef, useState } from 'react'
import type { SavedInstrument } from '../audio/contracts'
import {
  deleteInstrument,
  duplicateInstrument,
  listInstruments,
  renameInstrument,
} from '../persistence/instruments'
import { Modal } from './Modal'

export interface SessionsModalProps {
  currentName: string
  onClose: () => void
  /** Persist the current patch under a name; returns the saved instrument. */
  onSave: (name: string) => Promise<void>
  onLoad: (id: string) => Promise<void>
  onExport: (id: string) => Promise<void>
  onImport: (file: File) => Promise<void>
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

export function SessionsModal({
  currentName,
  onClose,
  onSave,
  onLoad,
  onExport,
  onImport,
}: SessionsModalProps) {
  const [items, setItems] = useState<SavedInstrument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(currentName)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = async () => {
    try {
      setItems(await listInstruments())
      setError(null)
    } catch {
      setError('Saved sessions are unavailable (storage blocked or full).')
      setItems([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const wrap = async (fn: () => Promise<void>, failMsg: string) => {
    try {
      await fn()
      setError(null)
      await refresh()
    } catch {
      setError(failMsg)
    }
  }

  return (
    <Modal
      title="Sessions"
      onClose={onClose}
      description="Save and recall full performance states. Export to JSON for backup or sharing files."
    >
      <div className="sessions">
        <form
          className="sessions__save"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void wrap(() => onSave(name.trim()), 'Could not save session.')
          }}
        >
          <label className="field">
            <span className="field__label">Save current as</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Session name"
              aria-label="Session name"
            />
          </label>
          <button type="submit" className="button button--primary" disabled={!name.trim()}>
            Save
          </button>
        </form>

        <div className="sessions__io">
          <button type="button" className="chip" onClick={() => fileRef.current?.click()}>
            Import JSON…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Import a session JSON file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void wrap(() => onImport(f), 'Could not import that file.')
              e.target.value = ''
            }}
          />
        </div>

        {error ? (
          <p className="share__error" role="alert">
            {error}
          </p>
        ) : null}

        {items == null ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No saved sessions yet. Save the current performance to start a library.</p>
        ) : (
          <ul className="sessions__list">
            {items.map((it) => (
              <li key={it.id} className="sessions__item">
                {renaming === it.id ? (
                  <form
                    className="sessions__rename"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = renameValue.trim()
                      if (v) {
                        void wrap(() => renameInstrument(it.id, v), 'Could not rename.')
                        setRenaming(null)
                      }
                    }}
                  >
                    <input
                      className="input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label={`New name for ${it.name}`}
                      autoFocus
                    />
                    <button type="submit" className="chip">
                      Save
                    </button>
                    <button type="button" className="chip" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="sessions__meta">
                      <span className="sessions__name">{it.name}</span>
                      <span className="sessions__date">{fmtDate(it.updatedAt)}</span>
                    </div>
                    <div className="sessions__actions">
                      <button type="button" className="chip" onClick={() => void wrap(() => onLoad(it.id), 'Could not load.')}>
                        Load
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setRenaming(it.id)
                          setRenameValue(it.name)
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() =>
                          void wrap(
                            () => duplicateInstrument(it.id, crypto.randomUUID(), Date.now()).then(() => undefined),
                            'Could not duplicate.',
                          )
                        }
                      >
                        Duplicate
                      </button>
                      <button type="button" className="chip" onClick={() => void wrap(() => onExport(it.id), 'Could not export.')}>
                        Export
                      </button>
                      {confirmingDelete === it.id ? (
                        <span className="sessions__confirm" role="group" aria-label={`Confirm delete ${it.name}`}>
                          <button
                            type="button"
                            className="chip chip--danger"
                            onClick={() => {
                              void wrap(() => deleteInstrument(it.id), 'Could not delete.')
                              setConfirmingDelete(null)
                            }}
                          >
                            Confirm delete
                          </button>
                          <button type="button" className="chip" onClick={() => setConfirmingDelete(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="chip chip--danger" onClick={() => setConfirmingDelete(it.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
