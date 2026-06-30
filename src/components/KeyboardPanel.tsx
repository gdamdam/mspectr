/**
 * KeyboardPanel — computer-keyboard playing on/off plus an on-screen hint of the
 * key mapping. The actual key capture is wired at the window level in useEngine;
 * this panel only toggles the enabled flag and teaches the layout.
 */
export interface KeyboardPanelProps {
  enabled: boolean
  onToggle: (on: boolean) => void
}

export function KeyboardPanel({ enabled, onToggle }: KeyboardPanelProps) {
  return (
    <section className="panel kbd" aria-labelledby="kbd-heading">
      <h2 id="kbd-heading" className="panel__eyebrow">
        Computer keyboard
      </h2>
      <label className="switch">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">{enabled ? 'Playing enabled' : 'Playing off'}</span>
      </label>
      <p className="kbd__hint">
        <kbd>A</kbd>–<kbd>L</kbd> play white keys, <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd>… the black keys.{' '}
        <kbd>Z</kbd>/<kbd>X</kbd> shift octave, <kbd>C</kbd>/<kbd>V</kbd> set velocity.
      </p>
    </section>
  )
}
