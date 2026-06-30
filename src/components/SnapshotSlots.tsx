/**
 * SnapshotSlots — the two captured spectral identities, A and B. Each slot shows
 * its source label, capture timestamp, a live-derived badge (text, not color
 * alone), and per-slot audition + clear. Slot-level swap / copy / capture live in
 * CapturePanel; this component is the read + audition surface.
 */
import type { SnapshotSlot } from '../audio/contracts'
import type { SlotMeta } from '../app/state'

export interface SnapshotSlotsProps {
  a: SlotMeta | null
  b: SlotMeta | null
  auditioning: SnapshotSlot | null
  onAudition: (slot: SnapshotSlot | null) => void
  onClear: (slot: SnapshotSlot) => void
}

function timeLabel(ms: number | null): string {
  if (ms == null) return 'empty'
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Slot({
  slot,
  meta,
  auditioning,
  onAudition,
  onClear,
}: {
  slot: SnapshotSlot
  meta: SlotMeta | null
  auditioning: SnapshotSlot | null
  onAudition: (slot: SnapshotSlot | null) => void
  onClear: (slot: SnapshotSlot) => void
}) {
  const filled = meta != null
  const isAuditioning = auditioning === slot
  return (
    <div className="slot" data-slot={slot} data-filled={filled} data-auditioning={isAuditioning || undefined}>
      <div className="slot__head">
        <span className="slot__id">{slot}</span>
        {meta?.isLiveDerived ? (
          <span className="badge badge--live" title="Captured from live input (mic/tab)">
            live-derived
          </span>
        ) : null}
      </div>
      <p className="slot__label">{filled ? meta!.label : 'No capture'}</p>
      <p className="slot__time">{timeLabel(meta?.capturedAt ?? null)}</p>
      <div className="slot__actions">
        <button
          type="button"
          className="chip"
          aria-pressed={isAuditioning}
          disabled={!filled}
          onClick={() => onAudition(isAuditioning ? null : slot)}
        >
          {isAuditioning ? 'Stop' : 'Audition'}
        </button>
        <button type="button" className="chip" disabled={!filled} onClick={() => onClear(slot)}>
          Clear
        </button>
      </div>
    </div>
  )
}

export function SnapshotSlots({ a, b, auditioning, onAudition, onClear }: SnapshotSlotsProps) {
  return (
    <section className="panel slots" aria-labelledby="slots-heading">
      <h2 id="slots-heading" className="panel__eyebrow">
        Snapshots
      </h2>
      <div className="slots__pair">
        <Slot slot="A" meta={a} auditioning={auditioning} onAudition={onAudition} onClear={onClear} />
        <Slot slot="B" meta={b} auditioning={auditioning} onAudition={onAudition} onClear={onClear} />
      </div>
    </section>
  )
}
