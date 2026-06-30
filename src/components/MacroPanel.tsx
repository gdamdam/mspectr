/**
 * MacroPanel — the four performance macros (BODY / MOTION / HARMONY / SPACE).
 *
 * Each macro has a knob plus a link/unlink toggle. When linked, the macro value
 * drives its target params via resolveParams; when unlinked, the hand-edited
 * baseline params stay authoritative (the takeover model). The link toggle shows
 * which raw params the macro touches (from MACRO_TARGETS) so the relationship is
 * legible, never hidden.
 */
import { MACRO_LABELS, MACRO_TARGETS } from '../performance/macros'
import { MACRO_IDS, type MacroId, type MacroLinks, type MacroValues } from '../audio/contracts'
import { Knob } from './Knob'

export interface MacroPanelProps {
  values: MacroValues
  links: MacroLinks
  onValue: (id: MacroId, v: number) => void
  onLink: (id: MacroId, linked: boolean) => void
}

function targetSummary(id: MacroId): string {
  return MACRO_TARGETS[id].join(', ')
}

export function MacroPanel({ values, links, onValue, onLink }: MacroPanelProps) {
  return (
    <section className="panel macros" aria-labelledby="macros-heading">
      <h2 id="macros-heading" className="panel__eyebrow">
        Macros
      </h2>
      <div className="macros__grid">
        {MACRO_IDS.map((id) => {
          const linked = links[id]
          return (
            <div key={id} className="macros__cell" data-linked={linked}>
              <Knob
                label={MACRO_LABELS[id]}
                value={values[id]}
                size="lg"
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onValue(id, v)}
                hint={linked ? targetSummary(id) : 'manual'}
              />
              <button
                type="button"
                className="macros__link"
                aria-pressed={linked}
                onClick={() => onLink(id, !linked)}
                title={`${MACRO_LABELS[id]} controls: ${targetSummary(id)}`}
              >
                <span aria-hidden="true">{linked ? '🔗' : '⛓️‍💥'}</span>
                {linked ? 'Linked' : 'Manual'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
