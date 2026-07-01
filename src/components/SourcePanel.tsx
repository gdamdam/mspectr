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
import type { GeneratedSourceId } from '../audio/contracts'
import { PRESETS } from '../performance/presets'
import { supportsInputDeviceSelection, supportsTabCapture } from '../sources/capabilities'
import type { AudioInputKind } from '../sources/types'

/** Title-case a source id, e.g. 'glass-harmonica' → 'Glass Harmonica'. */
export function soundLabel(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

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

      <label className="field" title="Load a built-in sound to analyse and play, as a starting point">
        <span className="field__label">Preset</span>
        <select
          className="select"
          value={presetId ?? ''}
          onChange={(e) => onSelectPreset(e.target.value)}
          disabled={!audioStarted}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.group} — {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Sound</span>
        <select
          className="select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onSelectSound(e.target.value as GeneratedSourceId)
          }}
          disabled={!audioStarted}
        >
          <option value="" disabled>
            Load a built-in sound…
          </option>
          {GENERATED_SOURCE_IDS.map((id) => (
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
    </section>
  )
}
