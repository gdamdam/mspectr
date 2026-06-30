// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DISPLAY_BINS, type EngineTelemetry } from '../audio/contracts'
import { SpectralDisplay, type SpectralDisplayProps } from './SpectralDisplay'

// jsdom does not implement the canvas 2D context. Provide a permissive stub so
// the rAF/resize draw path runs without throwing — we assert behaviour, not
// pixels.
function stub2dContext(): CanvasRenderingContext2D {
  const noop = () => {}
  return {
    canvas: document.createElement('canvas'),
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    setTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => stub2dContext(),
  )
  // Give the surface a non-zero box so coordinate math is exercised.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeTelemetry(over: Partial<EngineTelemetry> = {}): EngineTelemetry {
  const spectrum = new Float32Array(DISPLAY_BINS).fill(-100)
  for (let i = 0; i < DISPLAY_BINS; i++) spectrum[i] = -100 + (i / DISPLAY_BINS) * 80
  return {
    spectrum,
    frozen: null,
    activeVoices: 1,
    peak: 0.4,
    limiterGainReductionDb: 0,
    clip: false,
    frozenLive: false,
    liveBufferSeconds: 4,
    cpuLoad: 0.2,
    ...over,
  }
}

function setup(over: Partial<SpectralDisplayProps> = {}) {
  const onXYChange = vi.fn()
  const props: SpectralDisplayProps = {
    telemetry: null,
    xy: { x: 0.5, y: 0.5 },
    onXYChange,
    xyLabels: { x: 'Shift', y: 'Blur' },
    active: true,
    reducedMotion: false,
    reducedIntensity: false,
    ...over,
  }
  const utils = render(<SpectralDisplay {...props} />)
  return { onXYChange, ...utils }
}

describe('SpectralDisplay', () => {
  it('renders with null telemetry without crashing', () => {
    setup({ telemetry: null })
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('renders with a telemetry frame', () => {
    setup({ telemetry: makeTelemetry() })
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('renders a frozen overlay frame without crashing', () => {
    const frozen = new Float32Array(DISPLAY_BINS).fill(-60)
    setup({ telemetry: makeTelemetry({ frozen }) })
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('exposes the XY handle with an accessible name from the axis labels', () => {
    setup({ xyLabels: { x: 'Shift', y: 'Blur' } })
    const handle = screen.getByRole('slider')
    expect(handle).toHaveAccessibleName(/Shift/)
    expect(handle).toHaveAccessibleName(/Blur/)
  })

  it('shows a clip indicator only when clipping', () => {
    const { rerender } = setup({ telemetry: makeTelemetry({ clip: false }) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(
      <SpectralDisplay
        telemetry={makeTelemetry({ clip: true })}
        xy={{ x: 0.5, y: 0.5 }}
        onXYChange={() => {}}
        xyLabels={{ x: 'Shift', y: 'Blur' }}
        active
        reducedMotion={false}
        reducedIntensity={false}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/clip/i)
  })

  it('ArrowRight / ArrowLeft move x and clamp within 0..1', () => {
    const { onXYChange } = setup({ xy: { x: 0.5, y: 0.5 } })
    const handle = screen.getByRole('slider')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onXYChange).toHaveBeenLastCalledWith(0.52, 0.5)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onXYChange).toHaveBeenLastCalledWith(0.48, 0.5)
  })

  it('ArrowUp / ArrowDown move y', () => {
    const { onXYChange } = setup({ xy: { x: 0.5, y: 0.5 } })
    const handle = screen.getByRole('slider')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onXYChange).toHaveBeenLastCalledWith(0.5, 0.52)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onXYChange).toHaveBeenLastCalledWith(0.5, 0.48)
  })

  it('Shift+Arrow is a coarse step', () => {
    const { onXYChange } = setup({ xy: { x: 0.5, y: 0.5 } })
    const handle = screen.getByRole('slider')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    const [x] = onXYChange.mock.calls[0]
    expect(x).toBeCloseTo(0.6, 5)
  })

  it('clamps at the unit-square edges', () => {
    const { onXYChange } = setup({ xy: { x: 0, y: 1 } })
    const handle = screen.getByRole('slider')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onXYChange).toHaveBeenLastCalledWith(0, 1)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onXYChange).toHaveBeenLastCalledWith(0, 1)
  })

  it('pointer drag on the surface calls onXYChange with mapped, clamped coords', () => {
    const { onXYChange } = setup()
    const handle = screen.getByRole('slider')
    const surface = handle.parentElement as HTMLElement
    // jsdom's synthetic PointerEvent drops clientX/clientY, so dispatch a
    // MouseEvent (PointerEvent's base) named pointerdown/move — React reads the
    // native event's coords from it. 400x300 box.
    const fire = (type: string, clientX: number, clientY: number) =>
      surface.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }))

    // clientX=100 → x=0.25 ; clientY=150 → y = 1 - 0.5 = 0.5
    fire('pointerdown', 100, 150)
    expect(onXYChange).toHaveBeenLastCalledWith(0.25, 0.5)
    // Drag must be active (set on pointerdown) for moves to register.
    fire('pointermove', 200, 75)
    expect(onXYChange).toHaveBeenLastCalledWith(0.5, 0.75)
  })
})
