/**
 * Knob — an accessible rotary control built on ARIA slider semantics.
 *
 * Interaction: vertical pointer drag, arrow keys (Shift = coarse, Home/End =
 * extremes), and mouse wheel. The visual is a 270° arc indicator; the actual
 * focusable element is a div with role="slider" so screen readers announce the
 * label and value. The value text is always shown (no state-by-color-alone).
 */
import { useCallback, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

export interface KnobProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  /** Format the value for display + aria-valuetext (e.g. percent, dB). */
  format?: (v: number) => string
  onChange: (v: number) => void
  /** Optional secondary line under the label (e.g. what a macro touches). */
  hint?: string
  disabled?: boolean
  /** Larger size for the primary macro knobs. */
  size?: 'sm' | 'lg'
}

const ARC_START = -135 // degrees
const ARC_SWEEP = 270

export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  onChange,
  hint,
  disabled = false,
  size = 'sm',
}: KnobProps) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)
  const span = max - min || 1
  const norm = Math.min(1, Math.max(0, (value - min) / span))
  const angle = ARC_START + norm * ARC_SWEEP
  const display = format ? format(value) : value.toFixed(2)

  const commit = useCallback(
    (v: number) => {
      const clamped = Math.min(max, Math.max(min, v))
      // Snap to step to avoid float drift.
      const snapped = Math.round(clamped / step) * step
      onChange(Math.min(max, Math.max(min, snapped)))
    },
    [min, max, step, onChange],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      dragRef.current = { startY: e.clientY, startVal: value }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [disabled, value],
  )
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d) return
      // 200px of vertical travel covers the full range; up increases.
      const delta = (d.startY - e.clientY) / 200
      commit(d.startVal + delta * span)
    },
    [commit, span],
  )
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const coarse = e.shiftKey ? 10 : 1
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight': commit(value + step * coarse); break
        case 'ArrowDown':
        case 'ArrowLeft': commit(value - step * coarse); break
        case 'Home': commit(min); break
        case 'End': commit(max); break
        case 'PageUp': commit(value + step * 10); break
        case 'PageDown': commit(value - step * 10); break
        default: return
      }
      e.preventDefault()
    },
    [disabled, commit, value, step, min, max],
  )

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (disabled) return
      commit(value + (e.deltaY < 0 ? step : -step))
    },
    [disabled, commit, value, step],
  )

  return (
    <div className={`knob knob--${size}`} data-disabled={disabled || undefined}>
      <div
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={display}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      >
        <span
          className="knob__pointer"
          style={{ transform: `rotate(${angle}deg)` }}
          aria-hidden="true"
        />
        <span className="knob__value" aria-hidden="true">
          {display}
        </span>
      </div>
      <span className="knob__label">{label}</span>
      {hint ? <span className="knob__hint">{hint}</span> : null}
    </div>
  )
}
