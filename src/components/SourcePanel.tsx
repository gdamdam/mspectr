/**
 * SourcePanel — choosing what the instrument analyses. A compact preset/source
 * selector, the Start Audio gesture, an input-status indicator, and the live
 * input options (file drop/pick, mic with optional device select, tab audio
 * where supported). Mic/tab require explicit permission and never monitor —
 * the App shows the headphone warning before any live monitoring is enabled.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { GENERATED_SOURCE_IDS } from '../audio/contracts'
import type { GeneratedSourceId, Preset } from '../audio/contracts'
import { PRESETS } from '../performance/presets'
import { supportsInputDeviceSelection, supportsTabCapture } from '../sources/capabilities'
import type { AudioInputKind } from '../sources/types'

/** Title-case a source id, e.g. 'glass-harmonica' → 'Glass Harmonica'. */
export function soundLabel(id: string): string {
  return id
    .split('-')
    .map((w) => (w === 'fm' ? 'FM' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Presets grouped by section, with both groups and names in alphabetical order. */
const PRESET_GROUPS: { group: string; presets: Preset[] }[] = (() => {
  const byGroup = new Map<string, Preset[]>()
  for (const p of PRESETS) {
    const list = byGroup.get(p.group)
    if (list) list.push(p)
    else byGroup.set(p.group, [p])
  }
  return Array.from(byGroup.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, presets]) => ({
      group,
      presets: presets.slice().sort((x, y) => x.name.localeCompare(y.name)),
    }))
})()

/** Built-in source ids sorted by display label. */
const SORTED_SOUND_IDS = GENERATED_SOURCE_IDS.slice().sort((a, b) => soundLabel(a).localeCompare(soundLabel(b)))

export interface SourcePanelProps {
  audioStarted: boolean
  sourceKind: AudioInputKind
  sourceLabel: string
  starting: boolean
  presetId: string | null
  onStart: () => void
  onSelectPreset: (presetId: string) => void
  onSelectSound: (id: GeneratedSourceId) => void
  onPickFile: (file: File) => void
  onEnableMic: (deviceId?: string) => void
  onEnableTab: () => void
  listMicDevices: () => Promise<MediaDeviceInfo[]>
  /** Whether the live source is heard through the output (generated only). */
  monitor: boolean
  onToggleMonitor: (on: boolean) => void
}

const KIND_LABEL: Record<AudioInputKind, string> = {
  generated: 'Generated',
  file: 'File',
  microphone: 'Microphone',
  tab: 'Tab audio',
}

export function SourcePanel({
  audioStarted,
  sourceKind,
  sourceLabel,
  starting,
  presetId,
  onStart,
  onSelectPreset,
  onSelectSound,
  onPickFile,
  onEnableMic,
  onEnableTab,
  listMicDevices,
  monitor,
  onToggleMonitor,
}: SourcePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onPickFile(f)
    e.target.value = ''
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onPickFile(f)
  }

  const refreshDevices = async () => {
    try {
      const list = await listMicDevices()
      setDevices(list.filter((d) => d.kind === 'audioinput'))
    } catch {
      setDevices([])
    }
  }

  return (
    <section className="panel source" aria-labelledby="source-heading">
      <h2 id="source-heading" className="panel__eyebrow">
        Source
      </h2>

      {!audioStarted ? (
        <button
          type="button"
          className="button button--primary button--start"
          title="Start the audio engine — needed before capturing or playing"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? 'Starting…' : 'Start audio'}
        </button>
      ) : (
        <p className="source__status" role="status">
          <span className="source__dot" data-kind={sourceKind} aria-hidden="true" />
          <span className="source__kind">{KIND_LABEL[sourceKind]}</span>
          <span className="source__name">{sourceLabel}</span>
        </p>
      )}

      {/* PRESET — a complete scene: sets a sound AND all the controls at once. */}
      <div className="source__group">
        <p className="source__grouplabel">
          Preset <span className="source__grouphint">— a complete scene</span>
        </p>
        <select
          className="select"
          aria-label="Preset — loads a complete scene (a sound plus all the controls)"
          title="Loads a complete scene: a sound plus all the controls"
          value={presetId ?? ''}
          onChange={(e) => onSelectPreset(e.target.value)}
          disabled={!audioStarted}
        >
          {PRESET_GROUPS.map(({ group, presets }) => (
            <optgroup key={group} label={group}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <hr className="source__rule" />

      {/* INPUT — the raw material the instrument analyses (built-in sound, file,
          mic, or tab). Changing it leaves the controls untouched. */}
      <div className="source__group">
        <p className="source__grouplabel">
          Input source <span className="source__grouphint">— what it listens to</span>
        </p>

        <label className="field">
          <span className="field__label">Built-in sound</span>
          <select
            className="select"
            defaultValue=""
            title="Swap the raw sound being analysed, without changing the controls"
            onChange={(e) => {
              if (e.target.value) onSelectSound(e.target.value as GeneratedSourceId)
            }}
            disabled={!audioStarted}
          >
            <option value="" disabled>
              Load a built-in sound…
            </option>
            {SORTED_SOUND_IDS.map((id) => (
              <option key={id} value={id}>
                {soundLabel(id)}
              </option>
            ))}
          </select>
        </label>

      <div
        className="dropzone"
        data-dragging={dragging || undefined}
        data-active={sourceKind === 'file' || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone__hint">Drop an audio file</p>
        <button
          type="button"
          className="chip"
          disabled={!audioStarted}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="visually-hidden"
          onChange={onFileChange}
          aria-label="Choose an audio file to analyse"
        />
      </div>

      <div className="source__live">
        {supportsInputDeviceSelection() && devices.length > 0 ? (
          <label className="field">
            <span className="field__label">Input device</span>
            <select className="select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Input'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="chip"
          data-active={sourceKind === 'microphone' || undefined}
          disabled={!audioStarted}
          title="Analyse live microphone input (asks for permission)"
          onClick={async () => {
            if (supportsInputDeviceSelection()) await refreshDevices()
            onEnableMic(deviceId || undefined)
          }}
        >
          Enable mic
        </button>
        {supportsTabCapture() ? (
          <button
            type="button"
            className="chip"
            data-active={sourceKind === 'tab' || undefined}
            disabled={!audioStarted}
            onClick={onEnableTab}
            title="Capture audio from a browser tab (Chromium desktop)"
          >
            Tab audio
          </button>
        ) : null}
        </div>

        {audioStarted ? (
          <label className="source__monitor">
            <input
              type="checkbox"
              checked={monitor && sourceKind === 'generated'}
              disabled={sourceKind !== 'generated'}
              onChange={(e) => onToggleMonitor(e.target.checked)}
            />
            <span>
              Monitor source
              {sourceKind === 'generated' ? null : (
                <span className="muted"> — mic/tab never monitor (feedback safety)</span>
              )}
            </span>
          </label>
        ) : null}
      </div>
    </section>
  )
}
