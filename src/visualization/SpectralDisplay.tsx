/**
 * SpectralDisplay — the primary surface of mspectr.
 *
 * It renders the live spectrum as *material being touched*, overlays any
 * frozen/captured energy as a cooled persistence layer behind it, and floats
 * the XY performance surface directly on top so the player shapes the sound on
 * the same plane they read it. One <canvas> is repainted on a rAF loop at the
 * display fps; everything else (handle, labels, clip flag) is DOM so it stays
 * accessible and crisp.
 *
 * This component is a *consumer* of telemetry. It never computes FFTs or touches
 * audio — it only paints the dB arrays the engine already produced, and it
 * honestly flatlines on silence rather than inventing motion.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { EngineTelemetry } from '../audio/contracts'
import { DISPLAY_BINS } from '../audio/contracts'
import {
  accumulatePersistence,
  binToX,
  clampXY,
  dbToY,
  energyColor,
  frozenColor,
  hasEnergy,
} from './spectralPaint'

export interface SpectralDisplayProps {
  telemetry: EngineTelemetry | null
  xy: { x: number; y: number }
  onXYChange: (x: number, y: number) => void
  xyLabels: { x: string; y: string }
  active: boolean
  reducedMotion: boolean
  reducedIntensity: boolean
  className?: string
}

const FIELD = '#0a0e14'
const GRID = 'rgba(120, 150, 190, 0.07)'
const CLIP = '#ff4d4d'

const FPS_NORMAL = 30
const FPS_REDUCED = 12
/** Keyboard nudge per arrow press; Shift = coarse. */
const STEP_FINE = 0.02
const STEP_COARSE = 0.1
/** Per-frame retention for the frozen afterglow accumulator. */
const PERSIST_DECAY = 0.9

export function SpectralDisplay(props: SpectralDisplayProps): React.JSX.Element {
  const {
    telemetry,
    xy,
    onXYChange,
    xyLabels,
    active,
    reducedMotion,
    reducedIntensity,
    className,
  } = props

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)

  // Refs the rAF loop reads without re-subscribing — keeps the loop stable while
  // props change every frame.
  const telemetryRef = useRef(telemetry)
  const xyRef = useRef(xy)
  const flagsRef = useRef({ reducedMotion, reducedIntensity, active })
  // Mirror the latest props into the refs after each commit (not during render),
  // so the stable rAF loop always reads current values.
  useEffect(() => {
    telemetryRef.current = telemetry
    xyRef.current = xy
    flagsRef.current = { reducedMotion, reducedIntensity, active }
  })

  // Persistence accumulator for the frozen overlay, allocated once and reused —
  // bounded buffer, no per-frame allocation, no growth.
  const persistRef = useRef<Float32Array>(new Float32Array(DISPLAY_BINS))

  // Logical (CSS px) size tracked by the ResizeObserver; the canvas backing
  // store is sized to devicePixelRatio for crisp lines on HiDPI.
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })

  // ---- Drawing -----------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return

    const tel = telemetryRef.current
    const { reducedIntensity: dim } = flagsRef.current

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = FIELD
    ctx.fillRect(0, 0, w, h)

    drawGrid(ctx, w, h)

    // ---- Frozen / captured layer (persistence afterglow, behind live) ----
    const frozen = tel?.frozen ?? null
    const persist = persistRef.current
    const decay = dim ? 0.8 : PERSIST_DECAY
    accumulatePersistence(persist, frozen, frozen ? decay : 0)
    if (frozen && hasEnergy(frozen)) {
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let i = 0; i < persist.length; i++) {
        const x = binToX(i, w, persist.length)
        const y = h - persist[i] * h
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      // Cooled amber fill; held energy sits as a soft body behind the live curve.
      ctx.fillStyle = frozenColor(0.85, dim ? 0.1 : 0.18)
      ctx.fill()
      ctx.strokeStyle = frozenColor(1, dim ? 0.4 : 0.6)
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // ---- Live spectrum (primary material) --------------------------------
    const spectrum = tel?.spectrum ?? null
    if (spectrum && hasEnergy(spectrum)) {
      const n = spectrum.length
      // Filled gradient body.
      const grad = ctx.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, energyColor(0.2, dim ? 0.25 : 0.45))
      grad.addColorStop(0.6, energyColor(0.62, dim ? 0.3 : 0.55))
      grad.addColorStop(1, energyColor(1, dim ? 0.4 : 0.75))
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let i = 0; i < n; i++) {
        ctx.lineTo(binToX(i, w, n), dbToY(spectrum[i], h))
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Bright crest line tracing the spectral edge — the "touchable" surface.
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const x = binToX(i, w, n)
        const y = dbToY(spectrum[i], h)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineWidth = dim ? 1 : 1.5
      ctx.strokeStyle = energyColor(0.95, dim ? 0.7 : 0.95)
      ctx.stroke()
    } else {
      // Honest baseline: no audible energy ⇒ a quiet resting line, no motion.
      ctx.beginPath()
      ctx.moveTo(0, h - 1)
      ctx.lineTo(w, h - 1)
      ctx.strokeStyle = energyColor(0.2, 0.3)
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // ---- XY guide lines (faint crosshair through the handle) -------------
    const pos = clampXY(xyRef.current.x, xyRef.current.y)
    const hx = pos.x * w
    const hy = (1 - pos.y) * h // y axis reads bottom→top
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hx, 0)
    ctx.lineTo(hx, h)
    ctx.moveTo(0, hy)
    ctx.lineTo(w, hy)
    ctx.stroke()

    // ---- Clip indicator (edge pulse) -------------------------------------
    if (tel?.clip) {
      ctx.strokeStyle = CLIP
      ctx.lineWidth = 3
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3)
    }
  }, [])

  // ---- rAF loop, fps-gated ----------------------------------------------
  useEffect(() => {
    let raf = 0
    let last = 0
    const interval = () => 1000 / (flagsRef.current.reducedMotion ? FPS_REDUCED : FPS_NORMAL)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < interval()) return
      last = now
      draw()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  // ---- Resize handling (DPR-aware backing store) ------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    const surface = surfaceRef.current
    if (!canvas || !surface) return

    const resize = () => {
      const rect = surface.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    resize()
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(surface)
    window.addEventListener('resize', resize)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [draw])

  // ---- XY interaction ----------------------------------------------------
  const emitFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceRef.current
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const nx = (clientX - rect.left) / rect.width
      const ny = 1 - (clientY - rect.top) / rect.height // bottom→top
      const c = clampXY(nx, ny)
      onXYChange(c.x, c.y)
    },
    [onXYChange],
  )

  const draggingRef = useRef(false)
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      draggingRef.current = true
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      handleRef.current?.focus()
      emitFromClient(e.clientX, e.clientY)
    },
    [emitFromClient],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      emitFromClient(e.clientX, e.clientY)
    },
    [emitFromClient],
  )
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? STEP_COARSE : STEP_FINE
      let { x, y } = xyRef.current
      switch (e.key) {
        case 'ArrowRight':
          x += step
          break
        case 'ArrowLeft':
          x -= step
          break
        case 'ArrowUp':
          y += step
          break
        case 'ArrowDown':
          y -= step
          break
        default:
          return
      }
      e.preventDefault()
      const c = clampXY(x, y)
      onXYChange(c.x, c.y)
    },
    [onXYChange],
  )

  const pos = clampXY(xy.x, xy.y)
  const fmt = (v: number) => Math.round(v * 100)

  return (
    <div
      ref={surfaceRef}
      className={className}
      data-active={active ? 'true' : 'false'}
      style={SURFACE_STYLE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} style={CANVAS_STYLE} aria-hidden="true" />

      {/* Edge axis labels — what this surface controls in the active preset. */}
      <span style={LABEL_X_STYLE} aria-hidden="true">
        {xyLabels.x}
      </span>
      <span style={LABEL_Y_STYLE} aria-hidden="true">
        {xyLabels.y}
      </span>

      {telemetry?.clip ? (
        <span role="status" style={CLIP_BADGE_STYLE}>
          Clipping
        </span>
      ) : null}

      <button
        ref={handleRef}
        type="button"
        role="slider"
        aria-label={`Performance surface: ${xyLabels.x} and ${xyLabels.y}`}
        aria-valuetext={`${xyLabels.x} ${fmt(pos.x)} percent, ${xyLabels.y} ${fmt(pos.y)} percent`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fmt(pos.x)}
        onKeyDown={onKeyDown}
        style={{
          ...HANDLE_STYLE,
          left: `${pos.x * 100}%`,
          bottom: `${pos.y * 100}%`,
        }}
      >
        <span style={HANDLE_DOT_STYLE} aria-hidden="true" />
      </button>
    </div>
  )
}

// ---- Static styles (object literals; no external CSS dependency) ---------

const SURFACE_STYLE: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 180,
  background: FIELD,
  borderRadius: 2,
  overflow: 'hidden',
  touchAction: 'none',
  userSelect: 'none',
}

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'block',
}

const LABEL_BASE: React.CSSProperties = {
  position: 'absolute',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(170, 195, 225, 0.55)',
  pointerEvents: 'none',
}
const LABEL_X_STYLE: React.CSSProperties = {
  ...LABEL_BASE,
  right: 10,
  bottom: 8,
}
const LABEL_Y_STYLE: React.CSSProperties = {
  ...LABEL_BASE,
  left: 8,
  top: 10,
  writingMode: 'vertical-rl',
}

const CLIP_BADGE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: CLIP,
  background: 'rgba(255, 77, 77, 0.12)',
  border: `1px solid ${CLIP}`,
  borderRadius: 2,
  padding: '2px 6px',
  pointerEvents: 'none',
}

const HANDLE_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 44,
  height: 44,
  margin: 0,
  padding: 0,
  transform: 'translate(-50%, 50%)',
  background: 'transparent',
  border: 'none',
  borderRadius: '50%',
  cursor: 'grab',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'none',
}

const HANDLE_DOT_STYLE: React.CSSProperties = {
  display: 'block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'rgba(230, 240, 255, 0.92)',
  boxShadow: '0 0 0 6px rgba(122, 108, 240, 0.22), 0 0 12px rgba(240, 91, 212, 0.5)',
}

// ---- Drawing helpers ------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < 4; i++) {
    const x = (w * i) / 4
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    const y = (h * i) / 4
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
}
