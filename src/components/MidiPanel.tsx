/**
 * MidiPanel — enable Web MIDI and list connected input devices. Hidden entirely
 * when the browser lacks Web MIDI support so we never offer a dead control.
 */
import { supportsWebMidi } from '../sources/capabilities'

export interface MidiPanelProps {
  enabled: boolean
  devices: string[]
  onEnable: () => void
  /** Ableton Link status (via the localhost bridge). */
  link?: { connected: boolean; tempo: number; peers: number }
}

function LinkStatus({ link }: { link?: MidiPanelProps['link'] }) {
  if (!link?.connected) return null
  return (
    <p className="midi__state" role="status">
      <span className="state-pill" data-state="live">
        <span className="state-pill__dot" aria-hidden="true" />
        Link {Math.round(link.tempo)} BPM
        {link.peers > 0 ? ` · ${link.peers} peer${link.peers === 1 ? '' : 's'}` : ''}
      </span>
    </p>
  )
}

export function MidiPanel({ enabled, devices, onEnable, link }: MidiPanelProps) {
  if (!supportsWebMidi()) {
    return (
      <section className="panel midi" aria-labelledby="midi-heading">
        <h2 id="midi-heading" className="panel__eyebrow">
          MIDI
        </h2>
        <p className="muted">Web MIDI is not available in this browser.</p>
        <LinkStatus link={link} />
      </section>
    )
  }
  return (
    <section className="panel midi" aria-labelledby="midi-heading">
      <h2 id="midi-heading" className="panel__eyebrow">
        MIDI
      </h2>
      {enabled ? (
        <>
          <p className="midi__state" role="status">
            <span className="state-pill" data-state="live">
              <span className="state-pill__dot" aria-hidden="true" />
              Enabled
            </span>
          </p>
          {devices.length > 0 ? (
            <ul className="midi__devices">
              {devices.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No input devices connected.</p>
          )}
        </>
      ) : (
        <button type="button" className="button" onClick={onEnable}>
          Enable MIDI
        </button>
      )}
      <LinkStatus link={link} />
    </section>
  )
}
